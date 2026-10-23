import fs from "node:fs";
import { ALLOWED_MIME, AUDIO_EXTENSIONS, getConfig, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS } from "./config";
import { getDb, newId, now, parseJson } from "./db";
import { ffmpeg, MediaError } from "./media/ffmpeg";
import { makeThumbnail, measureDuration, probe, type ProbeResult } from "./media/probe";
import { transcribe } from "./speech/transcribe";
import { freeDiskBytes, getStorage } from "./storage";

export interface Asset {
  id: string;
  conversationId: string | null;
  kind: "upload" | "output";
  mediaType: "video" | "image" | "audio";
  originalName: string;
  storageKey: string;
  thumbKey: string | null;
  mime: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  metadata: Partial<ProbeResult> & { voiceNote?: boolean; transcript?: string; language?: string };
  createdAt: number;
}

/** Shape sent to the browser — no storage keys or paths. */
export interface PublicAsset {
  id: string;
  kind: Asset["kind"];
  mediaType: Asset["mediaType"];
  name: string;
  size: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  url: string;
  thumbnailUrl: string | null;
  /** Set for voice notes: what was said and the detected language code. */
  transcript?: string;
  language?: string;
}

export class UploadError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Row = Record<string, unknown>;

function fromRow(r: Row): Asset {
  return {
    id: r.id as string,
    conversationId: (r.conversation_id as string) ?? null,
    kind: r.kind as Asset["kind"],
    mediaType: r.media_type as Asset["mediaType"],
    originalName: r.original_name as string,
    storageKey: r.storage_key as string,
    thumbKey: (r.thumb_key as string) ?? null,
    mime: r.mime as string,
    size: r.size as number,
    duration: (r.duration as number) ?? null,
    width: (r.width as number) ?? null,
    height: (r.height as number) ?? null,
    hasAudio: !!r.has_audio,
    metadata: parseJson(r.metadata as string, {}),
    createdAt: r.created_at as number,
  };
}

export function toPublicAsset(a: Asset): PublicAsset {
  return {
    id: a.id,
    kind: a.kind,
    mediaType: a.mediaType,
    name: a.originalName,
    size: a.size,
    duration: a.duration,
    width: a.width,
    height: a.height,
    hasAudio: a.hasAudio,
    url: `/api/assets/${a.id}/file`,
    thumbnailUrl: a.thumbKey ? `/api/assets/${a.id}/thumbnail` : null,
    ...(a.metadata.voiceNote ? { transcript: a.metadata.transcript, language: a.metadata.language } : {}),
  };
}

export function getAsset(id: string): Asset | null {
  const r = getDb().prepare("SELECT * FROM assets WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function getAssets(ids: string[]): Asset[] {
  return ids.map(getAsset).filter((a): a is Asset => !!a);
}

/** Strips directories and control characters; keeps the name for display only. */
export function sanitizeDisplayName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.replace(/[\u0000-\u001f\u007f<>"]/g, "").trim().slice(0, 120);
  return clean || "file";
}

export function classifyUpload(name: string, mime: string): { ext: string; mediaType: Asset["mediaType"] } {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  const isVideoExt = (VIDEO_EXTENSIONS as readonly string[]).includes(ext);
  const isImageExt = (IMAGE_EXTENSIONS as readonly string[]).includes(ext);
  const isAudioExt = (AUDIO_EXTENSIONS as readonly string[]).includes(ext);
  if (!isVideoExt && !isImageExt && !isAudioExt) {
    throw new UploadError(415, `".${ext || "?"}" files aren't supported. Upload MP4, MOV, WebM, MKV, JPG, PNG, WebP, MP3, M4A or WAV.`);
  }
  const declared = ALLOWED_MIME[mime.toLowerCase()] ?? (/^audio\/(webm|ogg)/i.test(mime) ? "audio" : undefined);
  // Browser voice recordings arrive as audio/webm or audio/ogg.
  const mediaType = declared === "audio" && (ext === "webm" || ext === "ogg") ? "audio" : isVideoExt ? "video" : isImageExt ? "image" : "audio";
  const generic = !mime || mime === "application/octet-stream";
  if (!generic && !declared) throw new UploadError(415, `File type "${mime}" isn't supported.`);
  if (declared && declared !== mediaType) throw new UploadError(415, "The file extension doesn't match its content type.");
  return { ext: ext === "jpeg" ? "jpg" : ext, mediaType };
}

export async function ingestUpload(input: {
  body: AsyncIterable<Uint8Array>;
  originalName: string;
  mime: string;
  conversationId: string | null;
  declaredSize?: number;
  /** "voice" = a spoken instruction to transcribe, rather than a music track. */
  purpose?: "voice" | "media";
}): Promise<Asset> {
  const cfg = getConfig();
  const name = sanitizeDisplayName(input.originalName);
  const { ext, mediaType } = classifyUpload(name, input.mime);
  if (input.declaredSize && input.declaredSize > cfg.maxUploadBytes) {
    throw new UploadError(413, `File is larger than the ${Math.round(cfg.maxUploadBytes / 1048576)} MB limit.`);
  }
  if ((await freeDiskBytes()) < cfg.minFreeDiskBytes) {
    throw new UploadError(507, "The server is low on disk space. Delete old projects and try again.");
  }

  const storage = getStorage();
  storage.ensureDir("uploads");
  storage.ensureDir("thumbs");
  const id = newId("ast");
  const key = `uploads/${id}.${ext}`;
  const filePath = storage.absolutePath(key);

  let size = 0;
  const out = fs.createWriteStream(filePath, { flags: "wx" });
  try {
    for await (const chunk of input.body) {
      size += chunk.byteLength;
      if (size > cfg.maxUploadBytes) {
        throw new UploadError(413, `File is larger than the ${Math.round(cfg.maxUploadBytes / 1048576)} MB limit.`);
      }
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (size === 0) throw new UploadError(400, "The file is empty.");

    const info = await probe(filePath);
    if (!info.duration && (mediaType === "audio" || mediaType === "video")) {
      info.duration = await measureDuration(filePath, mediaType === "audio" ? "audio" : "video");
    }
    if (mediaType === "audio") return await finishAudio(info);
    if (!info.hasVideo) throw new UploadError(422, "No video or image content was found in this file.");
    if (mediaType === "video") {
      if (!info.duration || info.duration < 0.3) throw new UploadError(422, "This video is too short or has no readable duration.");
      if (info.duration > cfg.maxClipSeconds) {
        throw new UploadError(422, `Clips longer than ${Math.round(cfg.maxClipSeconds / 60)} minutes aren't supported yet.`);
      }
    }
    const thumbKey = `thumbs/${id}.jpg`;
    // Decoding a real frame doubles as a check that the codec is supported.
    await makeThumbnail(filePath, storage.absolutePath(thumbKey), mediaType === "video" ? info.duration : null);

    const asset: Asset = {
      id,
      conversationId: input.conversationId,
      kind: "upload",
      mediaType,
      originalName: name,
      storageKey: key,
      thumbKey,
      mime: input.mime || "application/octet-stream",
      size,
      duration: mediaType === "video" ? info.duration : null,
      width: info.width,
      height: info.height,
      hasAudio: mediaType === "video" && info.hasAudio,
      metadata: info,
      createdAt: now(),
    };
    insertAsset(asset);
    return asset;

    async function finishAudio(probed: typeof info): Promise<Asset> {
      if (!probed.hasAudio || !probed.duration || probed.duration < 0.5) throw new UploadError(422, "No playable audio was found in this file.");
      if (probed.duration > cfg.maxClipSeconds) throw new UploadError(422, "This audio file is too long.");
      // Decode the first seconds to confirm the codec is supported.
      await ffmpeg(["-t", "2", "-i", filePath, "-vn", "-f", "null", "-"], { timeoutMs: 30_000 });
      let metadata: Asset["metadata"] = probed;
      if (input.purpose === "voice") {
        const t = await transcribe(filePath, storage.absolutePath(`tmp/${id}`)).finally(() => storage.remove(`tmp/${id}`));
        if (!t.text) throw new UploadError(422, "I couldn't hear any words in that voice note. Please try again.");
        metadata = { ...probed, voiceNote: true, transcript: t.text, language: t.language };
      }
      const asset: Asset = {
        id, conversationId: input.conversationId, kind: "upload", mediaType: "audio", originalName: name, storageKey: key,
        thumbKey: null, mime: input.mime || "application/octet-stream", size, duration: probed.duration, width: null, height: null,
        hasAudio: true, metadata, createdAt: now(),
      };
      insertAsset(asset);
      return asset;
    }
  } catch (err) {
    out.destroy();
    storage.remove(key);
    storage.remove(`thumbs/${id}.jpg`);
    if (err instanceof UploadError) throw err;
    if (err instanceof MediaError) {
      throw new UploadError(err.code === "ffmpeg_missing" ? 500 : 422, err.userMessage);
    }
    throw err;
  }
}

export function insertAsset(a: Asset) {
  getDb()
    .prepare(
      `INSERT INTO assets (id, conversation_id, kind, media_type, original_name, storage_key, thumb_key, mime, size,
        duration, width, height, has_audio, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      a.id, a.conversationId, a.kind, a.mediaType, a.originalName, a.storageKey, a.thumbKey, a.mime, a.size,
      a.duration, a.width, a.height, a.hasAudio ? 1 : 0, JSON.stringify(a.metadata), a.createdAt,
    );
}

export function attachAssetsToConversation(ids: string[], conversationId: string) {
  const stmt = getDb().prepare("UPDATE assets SET conversation_id = ? WHERE id = ? AND (conversation_id IS NULL OR conversation_id = ?)");
  for (const id of ids) stmt.run(conversationId, id, conversationId);
}

export function deleteAssetFiles(a: Asset) {
  const storage = getStorage();
  storage.remove(a.storageKey);
  if (a.thumbKey) storage.remove(a.thumbKey);
}
