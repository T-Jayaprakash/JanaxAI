"use client";

import { Ban, Check, ChevronDown, CircleDashed, Loader2, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicAsset, PublicJob } from "@/lib/client/api";
import type { Stage } from "@/lib/jobs";
import { TimelinePreview } from "./TimelinePreview";

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

const elapsed = (from: number | null, to: number) => {
  if (!from) return "";
  const s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function JobCard({
  job,
  assets,
  workerAlive,
  onCancel,
  onRetry,
}: {
  job: PublicJob;
  assets: Record<string, PublicAsset>;
  workerAlive: boolean | null;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const running = !["completed", "failed", "cancelled"].includes(job.state);
  const [open, setOpen] = useState(running || job.state === "failed");
  const [tab, setTab] = useState<"steps" | "timeline" | "spec">("steps");
  const [busy, setBusy] = useState(false);
  const now = useNow(running);

  // Collapse automatically once the result is ready; reopen on failure.
  const [lastState, setLastState] = useState(job.state);
  if (lastState !== job.state) {
    setLastState(job.state);
    if (job.state === "completed") setOpen(false);
    if (job.state === "failed") setOpen(true);
  }

  const pipeline = job.stages.filter((s) => s.status !== "unavailable");
  const done = pipeline.filter((s) => s.status === "done").length;
  const active = job.stages.find((s) => s.status === "active");
  const waitingForWorker = job.state === "queued" && workerAlive === false;

  let title: string;
  let icon: React.ReactNode;
  if (job.state === "completed") {
    title = "Edit complete";
    icon = <Check size={16} className="text-accent" />;
  } else if (job.state === "failed") {
    title = "Render failed";
    icon = <TriangleAlert size={16} className="text-danger" />;
  } else if (job.state === "cancelled") {
    title = "Cancelled";
    icon = <Ban size={16} className="text-muted" />;
  } else if (job.state === "queued") {
    title = waitingForWorker ? "Waiting for the render worker" : "Queued";
    icon = <CircleDashed size={16} className={waitingForWorker ? "text-warn" : "text-muted"} />;
  } else {
    title = job.cancelRequested ? "Cancelling…" : (active?.label ?? "Editing your video");
    icon = <Loader2 size={16} className="animate-spin text-accent" />;
  }

  const act = async (fn: () => void | Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-line bg-card" aria-label="Editing activity">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-card-2/60"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-bg-2">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">
            {job.state === "queued"
              ? waitingForWorker
                ? "Start it with: npm run worker"
                : "Starting shortly"
              : `Step ${Math.min(done + (running ? 1 : 0), pipeline.length)} of ${pipeline.length}${
                  job.startedAt ? ` · ${elapsed(job.startedAt, job.finishedAt ?? now)}` : ""
                }`}
          </span>
        </span>
        <ChevronDown size={16} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {running && (
        <div className="h-0.5 w-full bg-line" aria-hidden="true">
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${(done / pipeline.length) * 100}%` }} />
        </div>
      )}

      {open && (
        <div className="border-t border-line px-4 pb-4 pt-3">
          <div className="mb-3 flex gap-1 text-xs" role="tablist">
            {(["steps", "timeline", "spec"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`rounded-full px-3 py-1 ${tab === t ? "bg-accent/15 text-accent" : "text-muted hover:text-ink"}`}
              >
                {t === "steps" ? "Steps" : t === "timeline" ? "Timeline" : "Edit spec"}
              </button>
            ))}
          </div>

          {tab === "steps" && (
            <ol className="space-y-0.5">
              {job.stages.map((s) => (
                <StageRow key={s.id} stage={s} />
              ))}
            </ol>
          )}
          {tab === "timeline" && <TimelinePreview job={job} assets={assets} />}
          {tab === "spec" && (
            <pre className="max-h-72 overflow-auto rounded-lg bg-bg-2 p-3 font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(job.spec, null, 2)}
            </pre>
          )}

          {job.error && (
            <div role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm">
              <p className="text-ink">{job.error.message}</p>
              {job.error.retryable && <p className="mt-0.5 text-xs text-muted">You can retry — your clips and settings are kept.</p>}
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[11px] text-faint">
              Planned by: {job.planInfo.planner}
              {job.planInfo.changes.length > 0 && job.parentVersionId ? ` · changes: ${job.planInfo.changes.join(", ")}` : ""}
            </p>
            {running && !job.cancelRequested && (
              <button
                onClick={() => act(onCancel)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted hover:border-line-strong hover:text-ink disabled:opacity-50"
              >
                <Square size={12} /> Cancel
              </button>
            )}
            {(job.state === "failed" || job.state === "cancelled") && (
              <button
                onClick={() => act(onRetry)}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:bg-accent-2 disabled:opacity-50"
              >
                <RotateCcw size={12} /> Retry
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function StageRow({ stage }: { stage: Stage }) {
  const [expanded, setExpanded] = useState(false);
  const hasLog = !!stage.log?.length;
  const icon = {
    done: <Check size={14} className="text-accent" />,
    active: <Loader2 size={14} className="animate-spin text-accent" />,
    failed: <X size={14} className="text-danger" />,
    skipped: <span className="block h-1.5 w-1.5 rounded-full bg-faint/60" />,
    pending: <span className="block h-2 w-2 rounded-full border border-faint" />,
    unavailable: <Ban size={13} className="text-faint" />,
  }[stage.status];
  const labelClass =
    stage.status === "pending" || stage.status === "skipped" || stage.status === "unavailable"
      ? "text-faint"
      : stage.status === "failed"
        ? "text-danger"
        : "text-ink";

  return (
    <li>
      <button
        type="button"
        disabled={!hasLog}
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={hasLog ? expanded : undefined}
        className="flex w-full items-start gap-3 rounded-lg px-1.5 py-1.5 text-left enabled:hover:bg-card-2/60"
      >
        <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`flex items-center gap-2 text-sm ${labelClass}`}>
            {stage.label}
            {stage.status === "unavailable" && <span className="rounded bg-line px-1.5 py-px text-[10px] uppercase tracking-wide text-muted">not available yet</span>}
            {hasLog && <ChevronDown size={12} className={`text-faint transition-transform ${expanded ? "rotate-180" : ""}`} />}
          </span>
          {stage.detail && <span className="block text-xs text-muted">{stage.detail}</span>}
          {stage.status === "active" && (
            <span className="mt-1.5 block h-1 w-full max-w-xs overflow-hidden rounded-full bg-line" aria-hidden="true">
              {stage.progress !== undefined ? (
                <span className="block h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round(stage.progress * 100)}%` }} />
              ) : (
                <span className="progress-indeterminate block h-full w-full" />
              )}
            </span>
          )}
        </span>
        {stage.status === "active" && stage.progress !== undefined && (
          <span className="font-mono text-[11px] text-muted">{Math.round(stage.progress * 100)}%</span>
        )}
      </button>
      {expanded && hasLog && (
        <ul className="mb-1 ml-9 space-y-0.5 rounded-lg bg-bg-2 px-3 py-2 font-mono text-[11px] text-muted">
          {stage.log!.map((l, i) => (
            <li key={i} className="break-all">
              {l}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
