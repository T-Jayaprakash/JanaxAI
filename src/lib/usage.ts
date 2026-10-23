import { getDb } from "./db";
import { PLANS, type Plan } from "./plans";

/**
 * Usage meters for the studio, computed from what actually happened (assistant
 * replies, delivered videos, bytes on disk) against the plan's limits.
 * Payments aren't live in the beta, so limits are shown but not enforced.
 */

export const SESSION_MS = 5 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export interface UsageMeter {
  id: "session" | "weekly" | "exports" | "storage";
  label: string;
  used: number;
  /** null = unlimited. */
  limit: number | null;
  unit: string;
  /** Epoch ms when it resets; null when nothing is counting yet. */
  resetsAt: number | null;
  note?: string;
}

export interface UsageReport {
  plan: { id: Plan["id"]; name: string };
  enforced: boolean;
  meters: UsageMeter[];
}

export function currentPlan(): Plan {
  const id = (process.env.JANUX_PLAN || "creator").trim();
  return PLANS.find((p) => p.id === id) ?? PLANS.find((p) => p.id === "creator")!;
}

/** Start of the current 5-hour session: the first request after the previous session ended. */
export function sessionStart(requestTimes: number[], now: number): number | null {
  let start: number | null = null;
  for (const t of [...requestTimes].sort((a, b) => a - b)) {
    if (t > now) break;
    if (start === null || t >= start + SESSION_MS) start = t;
  }
  return start !== null && now < start + SESSION_MS ? start : null;
}

/** Monday 12:00 AM IST of the week containing `now`, as epoch ms. */
export function weekStartIST(now: number): number {
  const ist = new Date(now + IST_OFFSET_MS);
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7;
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysSinceMonday);
  return midnight - IST_OFFSET_MS;
}

export function monthStartIST(now: number): { start: number; next: number } {
  const ist = new Date(now + IST_OFFSET_MS);
  return {
    start: Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_OFFSET_MS,
    next: Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1) - IST_OFFSET_MS,
  };
}

export async function usageReport(workspaceId: string, now = Date.now()): Promise<UsageReport> {
  const plan = currentPlan();
  const db = getDb();
  const since = Math.min(weekStartIST(now), now - 2 * SESSION_MS);
  // A request counts once the assistant starts working on it; queued or stopped-before-start ones don't.
  const times = (
    await db.all<{ created_at: number }>(
      "SELECT r.created_at FROM agent_runs r JOIN conversations c ON c.id = r.conversation_id WHERE c.workspace_id = ? AND r.created_at >= ? AND r.attempts > 0",
      [workspaceId, since],
    )
  ).map((r) => Number(r.created_at));
  const start = sessionStart(times, now);
  const week = weekStartIST(now);
  const month = monthStartIST(now);
  const exports = Number(
    (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM versions v JOIN conversations c ON c.id = v.conversation_id WHERE c.workspace_id = ? AND v.created_at >= ?", [workspaceId, month.start]))?.n ?? 0,
  );
  // Stored bytes: the workspace's uploads and renders, plus its kit.
  const stored =
    Number((await db.get<{ n: number }>("SELECT COALESCE(SUM(size), 0) AS n FROM assets WHERE workspace_id = ?", [workspaceId]))?.n ?? 0) +
    Number((await db.get<{ n: number }>("SELECT COALESCE(SUM(size), 0) AS n FROM kit_items WHERE workspace_id = ?", [workspaceId]))?.n ?? 0);
  return {
    plan: { id: plan.id, name: plan.name },
    enforced: false,
    meters: [
      {
        id: "session",
        label: "Current session",
        used: start === null ? 0 : times.filter((t) => t >= start && t <= now).length,
        limit: plan.limits.sessionRequests,
        unit: "requests",
        resetsAt: start === null ? null : start + SESSION_MS,
        note: start === null ? "Starts with your next message" : undefined,
      },
      { id: "weekly", label: "Weekly", used: times.filter((t) => t >= week && t <= now).length, limit: plan.limits.weeklyRequests, unit: "requests", resetsAt: week + 7 * 24 * 60 * 60 * 1000 },
      { id: "exports", label: "Exports this month", used: exports, limit: plan.limits.monthlyExports, unit: "videos", resetsAt: month.next },
      { id: "storage", label: "Storage", used: stored, limit: plan.limits.storageGB * 1024 ** 3, unit: "bytes", resetsAt: null },
    ],
  };
}
