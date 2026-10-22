import { getConfig } from "./config";
import { getDb, newId, now, parseJson } from "./db";
import type { EditSpec } from "./spec";
import type { Timeline } from "./timeline";

export const JOB_STATES = [
  "queued",
  "validating",
  "planning",
  "editing",
  "rendering",
  "finalizing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobState = (typeof JOB_STATES)[number];
export const ACTIVE_STATES: JobState[] = ["validating", "planning", "editing", "rendering", "finalizing"];
export const TERMINAL_STATES: JobState[] = ["completed", "failed", "cancelled"];

export type StageStatus = "pending" | "active" | "done" | "failed" | "skipped" | "unavailable";

export interface Stage {
  id: string;
  label: string;
  status: StageStatus;
  detail?: string;
  /** 0..1, only set when measured from the real process. */
  progress?: number;
  startedAt?: number;
  finishedAt?: number;
  log?: string[];
}

export interface PlanInfo {
  planner: string;
  usesAI: boolean;
  changes: string[];
  unsupported: string[];
  notes: string[];
}

export interface JobError {
  message: string;
  code: string;
  retryable: boolean;
  /** Internal only — stripped before sending to the browser. */
  diagnostic?: string;
}

export type JobKind = "edit" | "motion";

/** An animated HTML composition rendered frame by frame to MP4. */
export interface MotionSpec {
  title: string;
  format: "1:1" | "4:5" | "9:16" | "16:9";
  duration: number;
  fps: number;
  html: string;
}

export interface Job {
  id: string;
  kind: JobKind;
  conversationId: string;
  parentVersionId: string | null;
  /** EditSpec for kind "edit", MotionSpec for kind "motion". */
  spec: EditSpec;
  motion: MotionSpec | null;
  planInfo: PlanInfo;
  timeline: Timeline | null;
  state: JobState;
  stages: Stage[];
  error: JobError | null;
  outputVersionId: string | null;
  attempts: number;
  cancelRequested: boolean;
  heartbeatAt: number | null;
  startedAt: number | null;
  finishedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** The real pipeline steps. Each maps to work the worker actually performs. */
export const PIPELINE: { id: string; label: string; state: JobState }[] = [
  { id: "inspect", label: "Inspecting uploaded clips", state: "validating" },
  { id: "plan", label: "Building the editing timeline", state: "planning" },
  { id: "cut", label: "Cutting and reframing clips", state: "editing" },
  { id: "render", label: "Rendering transitions, look and audio", state: "rendering" },
  { id: "validate", label: "Checking the output file", state: "finalizing" },
  { id: "preview", label: "Preparing the preview", state: "finalizing" },
];

export const MOTION_PIPELINE: { id: string; label: string; state: JobState }[] = [
  { id: "prepare", label: "Preparing the animation", state: "validating" },
  { id: "frames", label: "Rendering frames and encoding", state: "rendering" },
  { id: "validate", label: "Checking the output file", state: "finalizing" },
  { id: "preview", label: "Preparing the preview", state: "finalizing" },
];

export function pipelineFor(kind: JobKind) {
  return kind === "motion" ? MOTION_PIPELINE : PIPELINE;
}

export function initialStages(unsupported: string[], kind: JobKind = "edit"): Stage[] {
  if (kind === "motion") return MOTION_PIPELINE.map((p) => ({ id: p.id, label: p.label, status: "pending" }));
  const stages: Stage[] = PIPELINE.map((p) => ({ id: p.id, label: p.label, status: "pending" }));
  // Requested-but-unimplemented steps are listed honestly instead of faked.
  const extra: Stage[] = [];
  for (const u of unsupported) {
    const lower = u.toLowerCase();
    if (lower.startsWith("captions")) extra.push({ id: "captions", label: "Adding captions", status: "unavailable", detail: u });
    else if (lower.startsWith("background music")) extra.push({ id: "music", label: "Mixing background music", status: "unavailable", detail: u });
    else if (lower.startsWith("voiceover")) extra.push({ id: "voice", label: "Adding voiceover", status: "unavailable", detail: u });
    else if (lower.startsWith("text")) extra.push({ id: "text", label: "Adding text overlays", status: "unavailable", detail: u });
  }
  stages.splice(4, 0, ...extra);
  return stages;
}

type Row = Record<string, unknown>;

function fromRow(r: Row): Job {
  const kind = ((r.kind as string) ?? "edit") as JobKind;
  const spec = parseJson(r.spec as string, {} as EditSpec);
  return {
    id: r.id as string,
    kind,
    motion: kind === "motion" ? (spec as unknown as MotionSpec) : null,
    conversationId: r.conversation_id as string,
    parentVersionId: (r.parent_version_id as string) ?? null,
    spec,
    planInfo: parseJson(r.plan_info as string, { planner: "", usesAI: false, changes: [], unsupported: [], notes: [] }),
    timeline: parseJson(r.timeline as string, null),
    state: r.state as JobState,
    stages: parseJson(r.stages as string, []),
    error: parseJson(r.error as string, null),
    outputVersionId: (r.output_version_id as string) ?? null,
    attempts: r.attempts as number,
    cancelRequested: !!r.cancel_requested,
    heartbeatAt: (r.heartbeat_at as number) ?? null,
    startedAt: (r.started_at as number) ?? null,
    finishedAt: (r.finished_at as number) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export function getJob(id: string): Job | null {
  const r = getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function listJobs(conversationId: string): Job[] {
  return (getDb().prepare("SELECT * FROM jobs WHERE conversation_id = ? ORDER BY created_at").all(conversationId) as Row[]).map(fromRow);
}

export function jobsUpdatedSince(conversationId: string, since: number): Job[] {
  return (
    getDb().prepare("SELECT * FROM jobs WHERE conversation_id = ? AND updated_at > ? ORDER BY updated_at").all(conversationId, since) as Row[]
  ).map(fromRow);
}

export function createJob(input: {
  conversationId: string;
  parentVersionId: string | null;
  spec: EditSpec;
  planInfo: PlanInfo;
  timeline: Timeline;
}): Job {
  return insertJob("edit", input.conversationId, input.parentVersionId, input.spec, input.planInfo, input.timeline);
}

export function createMotionJob(input: { conversationId: string; motion: MotionSpec; planInfo: PlanInfo }): Job {
  return insertJob("motion", input.conversationId, null, input.motion, input.planInfo, null);
}

function insertJob(kind: JobKind, conversationId: string, parentVersionId: string | null, spec: unknown, planInfo: PlanInfo, timeline: Timeline | null): Job {
  const t = now();
  const id = newId("job");
  getDb()
    .prepare(
      `INSERT INTO jobs (id, kind, conversation_id, parent_version_id, spec, plan_info, timeline, state, stages, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .run(
      id, kind, conversationId, parentVersionId, JSON.stringify(spec), JSON.stringify(planInfo),
      timeline ? JSON.stringify(timeline) : null, JSON.stringify(initialStages(planInfo.unsupported, kind)), t, t,
    );
  return getJob(id)!;
}

export function updateJob(id: string, patch: Partial<Pick<Job, "state" | "stages" | "error" | "outputVersionId" | "timeline" | "heartbeatAt" | "startedAt" | "finishedAt">>) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  const map: Record<string, [string, (v: unknown) => unknown]> = {
    state: ["state", (v) => v],
    stages: ["stages", (v) => JSON.stringify(v)],
    error: ["error", (v) => (v ? JSON.stringify(v) : null)],
    outputVersionId: ["output_version_id", (v) => v],
    timeline: ["timeline", (v) => JSON.stringify(v)],
    heartbeatAt: ["heartbeat_at", (v) => v],
    startedAt: ["started_at", (v) => v],
    finishedAt: ["finished_at", (v) => v],
  };
  for (const [k, v] of Object.entries(patch)) {
    const m = map[k];
    if (!m) continue;
    cols.push(`${m[0]} = ?`);
    vals.push(m[1](v));
  }
  cols.push("updated_at = ?");
  vals.push(now());
  getDb().prepare(`UPDATE jobs SET ${cols.join(", ")} WHERE id = ?`).run(...vals, id);
}

/** Atomically takes the oldest queued job. Safe with multiple workers. */
export function claimNextJob(): Job | null {
  const t = now();
  const r = getDb()
    .prepare(
      `UPDATE jobs SET state = 'validating', attempts = attempts + 1, started_at = ?, heartbeat_at = ?, updated_at = ?
       WHERE id = (SELECT id FROM jobs WHERE state = 'queued' AND cancel_requested = 0 ORDER BY created_at LIMIT 1)
         AND state = 'queued'
       RETURNING *`,
    )
    .get(t, t, t) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function isCancelRequested(id: string): boolean {
  const r = getDb().prepare("SELECT cancel_requested FROM jobs WHERE id = ?").get(id) as { cancel_requested: number } | undefined;
  return !r || !!r.cancel_requested;
}

export function requestCancel(id: string): Job | null {
  const job = getJob(id);
  if (!job || TERMINAL_STATES.includes(job.state)) return job;
  const db = getDb();
  if (job.state === "queued") {
    db.prepare("UPDATE jobs SET cancel_requested = 1, state = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?").run(now(), now(), id);
    const stages = job.stages.map((s) => (s.status === "pending" ? { ...s, status: "skipped" as const } : s));
    updateJob(id, { stages });
  } else {
    // The worker sees the flag, kills FFmpeg and marks the job cancelled.
    db.prepare("UPDATE jobs SET cancel_requested = 1, updated_at = ? WHERE id = ?").run(now(), id);
  }
  return getJob(id);
}

/** Puts a failed or cancelled job back in the queue with fresh stages. */
export function retryJob(id: string): Job | null {
  const job = getJob(id);
  if (!job || (job.state !== "failed" && job.state !== "cancelled")) return null;
  getDb()
    .prepare(
      `UPDATE jobs SET state = 'queued', stages = ?, error = NULL, cancel_requested = 0, attempts = 0,
       started_at = NULL, finished_at = NULL, heartbeat_at = NULL, updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(initialStages(job.planInfo.unsupported, job.kind)), now(), id);
  return getJob(id);
}

/**
 * Called when a worker starts: jobs left mid-flight by a crashed worker are
 * re-queued (up to the attempt limit) or failed with an explanation.
 */
export function recoverInterruptedJobs(): { requeued: number; failed: number } {
  const { maxJobAttempts } = getConfig();
  const stuck = (getDb().prepare(`SELECT * FROM jobs WHERE state IN (${ACTIVE_STATES.map(() => "?").join(",")})`).all(...ACTIVE_STATES) as Row[]).map(fromRow);
  let requeued = 0;
  let failed = 0;
  for (const job of stuck) {
    if (job.cancelRequested) {
      updateJob(job.id, { state: "cancelled", finishedAt: now() });
    } else if (job.attempts < maxJobAttempts) {
      getDb()
        .prepare("UPDATE jobs SET state = 'queued', stages = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(initialStages(job.planInfo.unsupported, job.kind)), now(), job.id);
      requeued++;
    } else {
      updateJob(job.id, {
        state: "failed",
        finishedAt: now(),
        error: { message: "The render worker stopped unexpectedly several times while processing this video.", code: "worker_crash", retryable: true },
      });
      failed++;
    }
  }
  return { requeued, failed };
}

export function setWorkerHeartbeat() {
  getDb().prepare("INSERT INTO meta (key, value) VALUES ('worker_heartbeat', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now()));
}

export function isWorkerAlive(): boolean {
  const r = getDb().prepare("SELECT value FROM meta WHERE key = 'worker_heartbeat'").get() as { value: string } | undefined;
  return !!r && now() - Number(r.value) < getConfig().workerStaleMs;
}

/** Browser-safe job view. */
export function toPublicJob(job: Job) {
  return {
    id: job.id,
    kind: job.kind,
    motion: job.motion ? { title: job.motion.title, format: job.motion.format, duration: job.motion.duration, fps: job.motion.fps } : null,
    conversationId: job.conversationId,
    parentVersionId: job.parentVersionId,
    spec: job.spec,
    planInfo: job.planInfo,
    timeline: job.timeline,
    state: job.state,
    stages: job.stages,
    error: job.error ? { message: job.error.message, code: job.error.code, retryable: job.error.retryable } : null,
    outputVersionId: job.outputVersionId,
    cancelRequested: job.cancelRequested,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
export type PublicJob = ReturnType<typeof toPublicJob>;
