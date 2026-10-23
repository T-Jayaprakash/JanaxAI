import type { PublicAsset } from "@/lib/assets";
import type { ConversationSnapshot, Message, PublicVersion } from "@/lib/conversations";
import type { PublicJob } from "@/lib/jobs";

export type { PublicAsset, ConversationSnapshot, Message, PublicVersion, PublicJob };

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  versionCount: number;
  latestJobState: string | null;
  latestThumbnailUrl: string | null;
}

export interface AppStatus {
  account: { email: string | null; name: string | null; workspaceId: string; workspaceName: string; role: "owner" | "admin" | "member"; signedIn: boolean };
  worker: { alive: boolean };
  planner: { label: string; usesAI: boolean };
  assistant: { id: string; label: string; devOnly: boolean } | null;
  capabilities: { designs: boolean; voiceNotes: boolean; voiceover: { label: string; premium: boolean } | null };
  limits: { maxUploadMB: number; maxFilesPerMessage: number; maxClipSeconds: number; maxOutputSeconds: number };
  usage: { renders: number; succeeded: number; failed: number; renderSeconds: number; outputSeconds: number; inputBytes: number; outputBytes: number };
  /** Server disk numbers; only shown in the local single-user studio. */
  storage: { usedBytes: number; freeBytes: number } | null;
}

export interface BrandKitView {
  businessName: string;
  tagline: string;
  phone: string;
  whatsapp: string;
  email: string;
  website: string;
  instagram: string;
  address: string;
  primaryColor: string;
  secondaryColor: string;
  logoAssetId: string | null;
  notes: string;
}

export interface ReplyMeta {
  status?: "pending" | "streaming" | "done" | "error";
  provider?: string;
  activity?: { label: string; status: "running" | "done" | "failed"; at?: number; images?: string[]; detail?: string; progress?: number }[];
  designs?: { title: string; kind: string; format: string; assetIds: string[] }[];
  jobIds?: string[];
  deliveries?: { versionId: string; title: string; credits?: string[] }[];
  error?: string;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && typeof window !== "undefined") {
    // The session ended (signed out elsewhere or expired): sign in again and come back.
    // A full page load drops all client state from the old session.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  listConversations: () => call<{ conversations: ConversationSummary[] }>("/api/conversations"),
  createConversation: () => call<ConversationSnapshot>("/api/conversations", { method: "POST" }),
  getConversation: (id: string) => call<ConversationSnapshot>(`/api/conversations/${id}`),
  renameConversation: (id: string, title: string) =>
    call(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteConversation: (id: string) => call(`/api/conversations/${id}`, { method: "DELETE" }),
  sendMessage: (id: string, text: string, attachmentIds: string[]) =>
    call<{ messages: Message[]; job: PublicJob | null }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, attachmentIds }),
    }),
  cancelJob: (id: string) => call<{ job: PublicJob }>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  retryJob: (id: string) => call<{ job: PublicJob }>(`/api/jobs/${id}/retry`, { method: "POST" }),
  status: () => call<AppStatus>("/api/status"),
  stopReply: (messageId: string) => call(`/api/messages/${messageId}/stop`, { method: "POST" }),
  getBrand: () => call<{ brand: BrandKitView; logo: PublicAsset | null }>("/api/brand"),
  saveBrand: (patch: Partial<BrandKitView>) => call<{ brand: BrandKitView; logo: PublicAsset | null }>("/api/brand", { method: "PUT", body: JSON.stringify(patch) }),
  deleteAllData: () => call("/api/data", { method: "DELETE" }),
};

/** Uploads raw file bytes with progress (fetch has no upload progress events). */
export function uploadFile(
  file: File,
  conversationId: string | null,
  onProgress: (fraction: number) => void,
  purpose: "media" | "voice" = "media",
): { promise: Promise<PublicAsset>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const params = new URLSearchParams({ name: file.name });
  if (conversationId) params.set("conversationId", conversationId);
  if (purpose === "voice") params.set("purpose", "voice");
  const promise = new Promise<PublicAsset>((resolve, reject) => {
    xhr.open("POST", `/api/uploads?${params}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { asset?: PublicAsset; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && body.asset) resolve(body.asset);
      else reject(new ApiError(xhr.status, body.error ?? "Upload failed."));
    };
    xhr.onerror = () => reject(new ApiError(0, "Network error during upload."));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled."));
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m ? `${m}:${s.toFixed(0).padStart(2, "0")}` : `${s.toFixed(1)}s`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(1)} GB`;
}

export type KitKind = "font" | "lut" | "logo" | "image" | "overlay" | "sfx" | "music" | "style";

export interface KitItemView {
  id: string;
  kind: KitKind;
  name: string;
  notes: string;
  credit: string | null;
  size: number;
  createdAt: number;
  hasFile: boolean;
  family?: string;
  meta: { width?: number; height?: number; duration?: number; alpha?: boolean; lutSize?: number };
}

export const kitApi = {
  list: () => call<{ items: KitItemView[] }>("/api/kit"),
  saveStyle: (name: string, notes: string) => call<{ item: KitItemView }>("/api/kit/style", { method: "POST", body: JSON.stringify({ name, notes }) }),
  remove: (id: string) => call(`/api/kit/${id}`, { method: "DELETE" }),
  upload(file: File, opts: { kind: Exclude<KitKind, "style">; name: string; notes: string; credit: string }, onProgress: (f: number) => void): Promise<KitItemView> {
    const params = new URLSearchParams({ kind: opts.kind, fileName: file.name, name: opts.name, notes: opts.notes, credit: opts.credit, rights: "1" });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/kit?${params}`);
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: { item?: KitItemView; error?: string } = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {}
        if (xhr.status >= 200 && xhr.status < 300 && body.item) resolve(body.item);
        else reject(new ApiError(xhr.status, body.error ?? "Upload failed."));
      };
      xhr.onerror = () => reject(new ApiError(0, "Network error during upload."));
      xhr.send(file);
    });
  },
};

export const deleteUnsentUpload = (id: string) => fetch(`/api/assets/${id}`, { method: "DELETE" }).catch(() => undefined);
