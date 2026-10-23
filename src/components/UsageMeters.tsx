"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/client/api";

export interface UsageMeter {
  id: "session" | "weekly" | "exports" | "storage";
  label: string;
  used: number;
  limit: number | null;
  unit: string;
  resetsAt: number | null;
  note?: string;
}

export interface UsageReport {
  plan: { id: string; name: string };
  enforced: boolean;
  meters: UsageMeter[];
}

/** Polls /api/usage; refreshes when a reply finishes (pass a changing key) and every minute. */
export function useUsage(refreshKey?: unknown): UsageReport | null {
  const [report, setReport] = useState<UsageReport | null>(null);
  const load = useCallback(() => {
    fetch("/api/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => r && setReport(r))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load, refreshKey]);
  return report;
}

const fraction = (m: UsageMeter) => (m.limit ? Math.min(1, m.used / m.limit) : 0);

function tone(f: number) {
  return f >= 1 ? "bg-danger" : f >= 0.8 ? "bg-warn" : "bg-ink";
}

function resetText(m: UsageMeter, now: number): string {
  if (m.note) return m.note;
  if (!m.resetsAt) return "";
  const ms = m.resetsAt - now;
  if (ms <= 0) return "Resetting…";
  if (ms < 24 * 3600_000) {
    const h = Math.floor(ms / 3600_000);
    const min = Math.max(1, Math.round((ms % 3600_000) / 60_000));
    return `Resets in ${h ? `${h} hr ` : ""}${min} min`;
  }
  const d = new Date(m.resetsAt);
  const day = d.toLocaleDateString("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" });
  const time = d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return ms < 7 * 24 * 3600_000 ? `Resets ${day} ${time}` : `Resets ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}`;
}

function amount(m: UsageMeter): string {
  if (m.unit === "bytes") return `${formatBytes(m.used)} of ${formatBytes(m.limit ?? 0)}`;
  return m.limit === null ? `${m.used} ${m.unit} · unlimited` : `${m.used} of ${m.limit} ${m.unit}`;
}

/** The meter list, used in the popover and the Account panel. */
export function UsageList({ report }: { report: UsageReport }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <ul className="space-y-4">
      {report.meters.map((m) => {
        const f = fraction(m);
        return (
          <li key={m.id}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-ink">{m.label}</span>
              <span className="text-right text-xs text-muted">
                {resetText(m, now)}
                {m.limit !== null && <span className="ml-2 tabular-nums text-ink">{Math.round(f * 100)}%</span>}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={m.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(f * 100)}>
              {m.limit !== null && <div className={`h-full rounded-full transition-[width] duration-500 ${tone(f)}`} style={{ width: `${Math.max(f > 0 ? 2 : 0, f * 100)}%` }} />}
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-faint">{amount(m)}</p>
          </li>
        );
      })}
    </ul>
  );
}

/** A ring showing the current session, opening the full usage popover. */
export function UsageRing({ report }: { report: UsageReport | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!report) return null;
  const session = report.meters.find((m) => m.id === "session")!;
  const f = fraction(session);
  const r = 7;
  const c = 2 * Math.PI * r;
  const stroke = f >= 1 ? "var(--color-danger)" : f >= 0.8 ? "var(--color-warn)" : "var(--color-ink)";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Usage: ${Math.round(f * 100)}% of this session`}
        title="Plan usage"
        className="grid h-7 w-7 place-items-center rounded-full hover:bg-card"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth="2" />
          <circle cx="9" cy="9" r={r} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 9 9)" />
        </svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Plan usage limits" className="absolute bottom-full right-0 z-40 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-line bg-bg-2 p-4 text-left shadow-2xl animate-rise">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-muted">
              Plan usage limits · <span className="text-ink">{report.plan.name}</span>
            </p>
            <Link href="/pricing" className="inline-flex items-center gap-1 text-xs text-ink hover:underline">
              See plans <ArrowRight size={12} />
            </Link>
          </div>
          <UsageList report={report} />
          {!report.enforced && <p className="mt-4 border-t border-line pt-3 text-[11px] text-faint">Free during the Trichy beta: limits are shown so you can see your usage, but nothing is blocked or billed.</p>}
        </div>
      )}
    </div>
  );
}
