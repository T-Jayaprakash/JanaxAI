"use client";

import { Film, ImagePlus, Loader2, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/client/auth";
import { api, formatBytes, uploadFile, type AppStatus, type BrandKitView, type ConversationSummary, type PublicAsset } from "@/lib/client/api";
import { UsageList, useUsage } from "./UsageMeters";

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-[2px]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-l border-line bg-bg-2 animate-rise"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button autoFocus onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-card hover:text-ink">
            <X size={17} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

export function ProjectsPanel({
  conversations,
  onOpen,
  onDelete,
  onClose,
}: {
  conversations: ConversationSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [onlyVideos, setOnlyVideos] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const shown = conversations.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()) && (!onlyVideos || c.versionCount > 0));
  return (
    <Sheet title="Projects" onClose={onClose}>
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-card px-3">
        <Search size={15} className="text-faint" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
          className="flex-1 bg-transparent py-2.5 text-sm focus:outline-none"
        />
      </div>
      <label className="mb-4 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={onlyVideos} onChange={(e) => setOnlyVideos(e.target.checked)} className="accent-[#F5F5F5]" />
        Only projects with finished videos
      </label>
      {shown.length === 0 && <p className="text-sm text-faint">No projects match.</p>}
      <ul className="grid grid-cols-2 gap-3">
        {shown.map((c) => (
          <li key={c.id} className="overflow-hidden rounded-xl border border-line bg-card">
            <button onClick={() => onOpen(c.id)} className="block w-full text-left">
              <div className="grid h-24 place-items-center bg-black">
                {c.latestThumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.latestThumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <Film size={20} className="text-faint" />
                )}
              </div>
              <div className="px-3 pt-2">
                <p className="truncate text-sm">{c.title}</p>
                <p className="text-[11px] text-faint">
                  {c.versionCount} version{c.versionCount === 1 ? "" : "s"} · {new Date(c.updatedAt).toLocaleDateString()}
                </p>
              </div>
            </button>
            <div className="flex justify-end px-2 pb-2">
              {confirming === c.id ? (
                <span className="flex gap-1 text-[11px]">
                  <button onClick={() => onDelete(c.id)} className="rounded bg-danger px-2 py-0.5 font-medium text-bg">
                    Delete
                  </button>
                  <button onClick={() => setConfirming(null)} className="px-2 py-0.5 text-muted">
                    Keep
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirming(c.id)} aria-label={`Delete ${c.title}`} className="p-1 text-faint hover:text-danger">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

export function AccountPanel({ onClose, onDataDeleted }: { onClose: () => void; onDataDeleted: () => void }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceLang, setVoiceLang] = useState(() => {
    try {
      return localStorage.getItem("janux.voiceLang") || "en-IN";
    } catch {
      return "en-IN";
    }
  });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.status().then(setStatus, (e: Error) => setError(e.message));
  }, []);

  return (
    <Sheet title="Account & usage" onClose={onClose}>
      <section className="mb-6">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Profile</h3>
        <div className="rounded-xl border border-line bg-card p-4 text-sm">
          {status?.account.signedIn ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate">{status.account.name || status.account.email}</p>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {status.account.email} · {status.account.workspaceName} ({status.account.role})
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await authClient.signOut().catch(() => undefined);
                  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                  window.location.href = "/login";
                }}
                className="shrink-0 rounded-full border border-line-strong px-3 py-1.5 text-xs text-ink hover:bg-bg-2"
              >
                Sign out
              </button>
            </div>
          ) : (
            <>
              <p>Local creator</p>
              <p className="mt-1 text-xs text-muted">Accounts are off on this computer (local development). Deployed servers always require sign-in.</p>
            </>
          )}
        </div>
      </section>

      <PlanUsage />

      <BrandKitForm />

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Usage (measured)</h3>
        {error && <p className="text-sm text-danger">{error}</p>}
        {status ? (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <Stat k="Renders" v={`${status.usage.succeeded} done · ${status.usage.failed} failed`} />
            <Stat k="Render time" v={`${status.usage.renderSeconds}s`} />
            <Stat k="Video produced" v={`${status.usage.outputSeconds}s`} />
            {status.storage && <Stat k="Storage used" v={formatBytes(status.storage.usedBytes)} />}
            {status.storage && <Stat k="Disk free" v={formatBytes(status.storage.freeBytes)} />}
            <Stat k="Render worker" v={status.worker.alive ? "running" : "offline"} warn={!status.worker.alive} />
          </dl>
        ) : (
          !error && <p className="text-sm text-faint">Loading…</p>
        )}
        <p className="mt-3 rounded-xl border border-line bg-card p-3 text-xs text-muted">
          Credits aren&apos;t enabled — renders are free in this local prototype. Pricing will be set after real per-video costs are measured.
        </p>
      </section>

      {status && (
        <section className="mb-6">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Limits & engine</h3>
          <ul className="space-y-1 text-xs text-muted">
            <li>Up to {status.limits.maxFilesPerMessage} files per message, {status.limits.maxUploadMB} MB each</li>
            <li>Clips up to {Math.round(status.limits.maxClipSeconds / 60)} min · output up to {status.limits.maxOutputSeconds}s</li>
            <li>Assistant: {status.assistant ? status.assistant.label : "off — add ANTHROPIC_API_KEY, or install Claude Code for local testing"}</li>
            <li>Video planner fallback: {status.planner.label}</li>
            <li>Designs: {status.capabilities.designs ? "Chrome renderer ready" : "needs Google Chrome"}</li>
            <li>Voice notes: {status.capabilities.voiceNotes ? "local Whisper (any language)" : "run npm run setup:speech"}</li>
            <li>
              Voiceover:{" "}
              {status.capabilities.voiceover
                ? status.capabilities.voiceover.premium
                  ? `${status.capabilities.voiceover.label} (premium)`
                  : `${status.capabilities.voiceover.label}: add an ElevenLabs or Google TTS key for natural voices`
                : "not available"}
            </li>
            <li>Video engine: FFmpeg on this computer</li>
          </ul>
        </section>
      )}

      <section className="mb-6">
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Preferences</h3>
        <label className="flex items-center justify-between gap-3 text-sm">
          Voice input language
          <select
            value={voiceLang}
            onChange={(e) => {
              setVoiceLang(e.target.value);
              try {
                localStorage.setItem("janux.voiceLang", e.target.value);
              } catch {}
            }}
            className="rounded-lg border border-line bg-card px-2 py-1.5 text-sm"
          >
            <option value="en-IN">English (India)</option>
            <option value="ta-IN">தமிழ் (Tamil)</option>
          </select>
        </label>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Privacy</h3>
        <p className="mb-3 text-xs leading-relaxed text-muted">
          Uploads, voice notes and renders are stored only in this app&apos;s data folder on this computer, and voice notes are transcribed locally. Your
          messages, the transcripts and the list of your files (names, not the files) are sent to Claude to write replies. Deleting a conversation deletes its files.
        </p>
        {confirmDelete ? (
          <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm">
            <p className="mb-2">Delete every conversation, upload and video? This can&apos;t be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  await api.deleteAllData();
                  setConfirmDelete(false);
                  onDataDeleted();
                }}
                className="rounded-lg bg-danger px-3 py-1.5 text-xs font-medium text-bg"
              >
                Delete everything
              </button>
              <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs text-muted">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="rounded-lg border border-danger/40 px-3 py-2 text-xs text-danger hover:bg-danger/10">
            Delete all my data
          </button>
        )}
      </section>
    </Sheet>
  );
}

function Stat({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2">
      <dt className="text-[11px] text-faint">{k}</dt>
      <dd className={warn ? "text-warn" : "text-ink"}>{v}</dd>
    </div>
  );
}

const BRAND_FIELDS: { key: keyof BrandKitView; label: string; placeholder?: string; type?: string }[] = [
  { key: "businessName", label: "Business name", placeholder: "Trichy Sweets" },
  { key: "tagline", label: "Tagline", placeholder: "Taste of tradition" },
  { key: "phone", label: "Phone", placeholder: "98765 43210", type: "tel" },
  { key: "whatsapp", label: "WhatsApp", placeholder: "98765 43210", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "website", label: "Website" },
  { key: "instagram", label: "Instagram", placeholder: "@yourbrand" },
  { key: "address", label: "Address" },
];

/** Logo, contacts and colours used automatically in designs. */
function BrandKitForm() {
  const [brand, setBrand] = useState<BrandKitView | null>(null);
  const [logo, setLogo] = useState<PublicAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    api.getBrand().then((r) => {
      setBrand(r.brand);
      setLogo(r.logo);
    }, () => setMessage("Couldn't load the brand kit."));
  }, []);

  if (!brand) return null;
  const set = (k: keyof BrandKitView, v: string) => setBrand({ ...brand, [k]: v });

  const save = async (patch: Partial<BrandKitView> = brand) => {
    setSaving(true);
    setMessage(null);
    try {
      const r = await api.saveBrand(patch);
      setBrand(r.brand);
      setLogo(r.logo);
      setMessage("Saved");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Brand kit</h3>
      <form
        className="space-y-3 rounded-xl border border-line bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="flex items-center gap-3">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-line bg-bg-2">
            {logo?.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo.url} alt="Logo" className="h-full w-full object-contain" />
            ) : uploading ? (
              <Loader2 size={18} className="animate-spin text-muted" />
            ) : (
              <ImagePlus size={18} className="text-faint" />
            )}
          </div>
          <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs text-muted hover:text-ink">
            {logo ? "Change logo" : "Upload logo"}
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                setUploading(true);
                try {
                  const asset = await uploadFile(f, null, () => undefined).promise;
                  await save({ logoAssetId: asset.id });
                } catch (err) {
                  setMessage(err instanceof Error ? err.message : "Logo upload failed.");
                } finally {
                  setUploading(false);
                }
              }}
            />
          </label>
          {logo && (
            <button type="button" onClick={() => void save({ logoAssetId: null })} className="text-xs text-faint hover:text-danger">
              Remove
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {BRAND_FIELDS.map((f) => (
            <label key={f.key} className="text-xs text-faint">
              {f.label}
              <input
                type={f.type ?? "text"}
                value={(brand[f.key] as string) ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => set(f.key, e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-sm text-ink focus:border-accent/50 focus:outline-none"
              />
            </label>
          ))}
          {(["primaryColor", "secondaryColor"] as const).map((k) => (
            <label key={k} className="text-xs text-faint">
              {k === "primaryColor" ? "Primary colour" : "Secondary colour"}
              <span className="mt-1 flex items-center gap-2">
                <input
                  type="color"
                  value={brand[k] || "#f5f5f5"}
                  onChange={(e) => set(k, e.target.value)}
                  className="h-8 w-10 cursor-pointer rounded border border-line bg-transparent"
                  aria-label={k === "primaryColor" ? "Primary colour" : "Secondary colour"}
                />
                <span className="text-sm text-muted">{brand[k] || "not set"}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="block text-xs text-faint">
          Notes for the assistant (audience, city, tone, languages)
          <textarea
            value={brand.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            className="mt-1 w-full resize-none rounded-lg border border-line bg-bg-2 px-2.5 py-1.5 text-sm text-ink focus:border-accent/50 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg hover:bg-accent-2 disabled:opacity-50">
            {saving ? "Saving…" : "Save brand kit"}
          </button>
          {message && <span className="text-xs text-muted">{message}</span>}
        </div>
      </form>
    </section>
  );
}

function PlanUsage() {
  const report = useUsage();
  return (
    <section className="mb-6">
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Plan usage limits{report ? ` · ${report.plan.name}` : ""}</h3>
      <div className="rounded-xl border border-line bg-card p-4">
        {report ? <UsageList report={report} /> : <p className="text-sm text-muted">Loading…</p>}
        {report && !report.enforced && <p className="mt-4 text-[11px] text-faint">Free during the Trichy beta: limits are shown, nothing is blocked or billed.</p>}
      </div>
    </section>
  );
}
