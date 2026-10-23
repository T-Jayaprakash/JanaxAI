import fs from "node:fs";
import { z } from "zod";
import { sanitizeDisplayName, UploadError } from "./assets";
import { getConfig } from "./config";
import { getDb, newId, now, parseJson } from "./db";
import { ffmpeg, MediaError } from "./media/ffmpeg";
import { measureDuration, probe } from "./media/probe";
import { freeDiskBytes, getStorage } from "./storage";

/**
 * My Kit: resources a user brings — their brand fonts, LUTs, logos, overlay
 * elements, sounds, music and saved editing styles. Files are validated by
 * content (not just extension), stored under data/kit/, and exposed to the
 * editor read-only as kit/<file> in every workspace.
 */

export const KIT_KINDS = ["font", "lut", "logo", "image", "overlay", "sfx", "music", "style"] as const;
export type KitKind = (typeof KIT_KINDS)[number];

export interface KitItem {
  id: string;
  kind: KitKind;
  name: string;
  /** File name inside kit/ (null for text-only styles). */
  file: string | null;
  notes: string;
  /** Credit line the user wants shown when it's used (e.g. a licensed pack). */
  credit: string | null;
  meta: Record<string, unknown>;
  size: number;
  createdAt: number;
}

const EXTENSIONS: Record<Exclude<KitKind, "style">, string[]> = {
  font: ["ttf", "otf", "woff", "woff2"],
  lut: ["cube"],
  logo: ["png", "jpg", "jpeg", "webp"],
  image: ["png", "jpg", "jpeg", "webp"],
  overlay: ["mov", "webm", "mp4", "gif"],
  sfx: ["wav", "mp3", "m4a", "aac", "ogg", "flac"],
  music: ["mp3", "wav", "m4a", "aac", "ogg", "flac"],
};

const MAX_BYTES: Record<Exclude<KitKind, "style">, number> = {
  font: 15 << 20,
  lut: 20 << 20,
  logo: 20 << 20,
  image: 30 << 20,
  overlay: 300 << 20,
  sfx: 30 << 20,
  music: 100 << 20,
};

export const KIT_ACCEPT = Object.fromEntries(Object.entries(EXTENSIONS).map(([k, v]) => [k, v.map((e) => `.${e}`).join(",")])) as Record<Exclude<KitKind, "style">, string>;

type Row = Record<string, unknown>;
const fromRow = (r: Row): KitItem => ({
  id: r.id as string,
  kind: r.kind as KitKind,
  name: r.name as string,
  file: (r.file as string) ?? null,
  notes: r.notes as string,
  credit: (r.credit as string) ?? null,
  meta: parseJson(r.meta as string, {}),
  size: r.size as number,
  createdAt: r.created_at as number,
});

export function listKit(kind?: KitKind): KitItem[] {
  const rows = kind
    ? getDb().prepare("SELECT * FROM kit_items WHERE kind = ? ORDER BY created_at DESC").all(kind)
    : getDb().prepare("SELECT * FROM kit_items ORDER BY created_at DESC").all();
  return (rows as Row[]).map(fromRow);
}

export function getKitItem(id: string): KitItem | null {
  const r = getDb().prepare("SELECT * FROM kit_items WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function kitDir(): string {
  return getStorage().ensureDir("kit");
}

/** CSS-safe family name for a user font, so HTML can say font-family:'Kit Name'. */
export function kitFontFamily(item: KitItem): string {
  return (item.meta.family as string) || item.name;
}

function cleanText(s: string | undefined | null, max: number): string {
  return (s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max);
}

function sniffFont(buf: Buffer): "truetype" | "opentype" | "woff" | "woff2" | null {
  const tag = buf.subarray(0, 4);
  if (tag.equals(Buffer.from([0, 1, 0, 0])) || tag.toString("latin1") === "true") return "truetype";
  if (tag.toString("latin1") === "OTTO") return "opentype";
  if (tag.toString("latin1") === "wOFF") return "woff";
  if (tag.toString("latin1") === "wOF2") return "woff2";
  return null;
}

/** Parses a .cube 3D LUT just enough to know FFmpeg will accept it. */
export function validateCube(text: string): { size: number } {
  const m = text.match(/^\s*LUT_3D_SIZE\s+(\d+)\s*$/m);
  if (!m) throw new UploadError(422, "This .cube file isn't a 3D LUT (no LUT_3D_SIZE line).");
  const size = Number(m[1]);
  if (size < 2 || size > 129) throw new UploadError(422, "The LUT size must be between 2 and 129.");
  let rows = 0;
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || /^[A-Z_]/.test(t)) continue;
    const parts = t.split(/\s+/);
    if (parts.length !== 3 || parts.some((p) => !Number.isFinite(Number(p)))) throw new UploadError(422, "This .cube file has an unreadable line.");
    rows++;
  }
  if (rows !== size ** 3) throw new UploadError(422, `This .cube file should have ${size ** 3} colour rows but has ${rows}.`);
  return { size };
}

export async function ingestKitFile(input: {
  body: AsyncIterable<Uint8Array>;
  kind: Exclude<KitKind, "style">;
  originalName: string;
  name?: string;
  notes?: string;
  credit?: string;
  declaredSize?: number;
}): Promise<KitItem> {
  const original = sanitizeDisplayName(input.originalName);
  const ext = (original.split(".").pop() ?? "").toLowerCase();
  if (!EXTENSIONS[input.kind].includes(ext)) {
    throw new UploadError(415, `For ${input.kind} upload ${EXTENSIONS[input.kind].map((e) => `.${e}`).join(", ")}.`);
  }
  const max = MAX_BYTES[input.kind];
  if (input.declaredSize && input.declaredSize > max) throw new UploadError(413, `That file is larger than the ${max >> 20} MB limit for ${input.kind}.`);
  if ((await freeDiskBytes()) < getConfig().minFreeDiskBytes) throw new UploadError(507, "The server is low on disk space. Delete old projects and try again.");

  const id = newId("kit");
  const fileName = `${id}.${ext === "jpeg" ? "jpg" : ext}`;
  const storage = getStorage();
  kitDir();
  const abs = storage.absolutePath(`kit/${fileName}`);
  let size = 0;
  const out = fs.createWriteStream(abs, { flags: "wx" });
  try {
    for await (const chunk of input.body) {
      size += chunk.byteLength;
      if (size > max) throw new UploadError(413, `That file is larger than the ${max >> 20} MB limit for ${input.kind}.`);
      if (!out.write(chunk)) await new Promise<void>((r) => out.once("drain", () => r()));
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
    if (size === 0) throw new UploadError(400, "The file is empty.");

    const name = cleanText(input.name, 80) || original.replace(/\.[^.]+$/, "").slice(0, 80);
    const meta: Record<string, unknown> = { originalName: original };
    if (input.kind === "font") {
      const format = sniffFont(fs.readFileSync(abs).subarray(0, 4));
      if (!format) throw new UploadError(422, "That doesn't look like a font file (TTF, OTF, WOFF or WOFF2).");
      meta.format = format;
      // Quotes and other CSS-breaking characters are removed from the family name.
      meta.family = name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || `Kit Font ${id.slice(-4)}`;
    } else if (input.kind === "lut") {
      meta.lutSize = validateCube(fs.readFileSync(abs, "utf8")).size;
    } else {
      const info = await probe(abs);
      if (input.kind === "logo" || input.kind === "image") {
        if (!info.hasVideo || !info.width) throw new UploadError(422, "That image couldn't be read.");
        Object.assign(meta, { width: info.width, height: info.height });
      } else if (input.kind === "overlay") {
        if (!info.hasVideo) throw new UploadError(422, "No video was found in that file.");
        const duration = info.duration || (await measureDuration(abs, "video"));
        const pix = info.pixFmt ?? "";
        Object.assign(meta, { width: info.width, height: info.height, duration, alpha: /^(yuva|argb|rgba|bgra|abgr|ya|gbrap|pal8)/.test(pix) });
      } else {
        if (!info.hasAudio) throw new UploadError(422, "No audio was found in that file.");
        const duration = info.duration || (await measureDuration(abs, "audio"));
        if (!duration || duration < 0.05) throw new UploadError(422, "That audio is too short to use.");
        await ffmpeg(["-t", "2", "-i", abs, "-vn", "-f", "null", "-"], { timeoutMs: 30_000 });
        meta.duration = duration;
      }
    }
    const item: KitItem = { id, kind: input.kind, name, file: fileName, notes: cleanText(input.notes, 2000), credit: cleanText(input.credit, 200) || null, meta, size, createdAt: now() };
    insertKitItem(item);
    return item;
  } catch (err) {
    out.destroy();
    fs.rmSync(abs, { force: true });
    if (err instanceof UploadError) throw err;
    if (err instanceof MediaError) throw new UploadError(422, err.userMessage);
    throw err;
  }
}

/** A saved editing style: the user's (or the editor's) recipe for their look. */
export const StyleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  notes: z.string().trim().min(1).max(4000),
});

export function saveStyle(input: z.infer<typeof StyleSchema>): KitItem {
  const existing = listKit("style").find((s) => s.name.toLowerCase() === input.name.toLowerCase());
  if (existing) {
    getDb().prepare("UPDATE kit_items SET notes = ? WHERE id = ?").run(cleanText(input.notes, 4000), existing.id);
    return { ...existing, notes: cleanText(input.notes, 4000) };
  }
  const item: KitItem = { id: newId("kit"), kind: "style", name: cleanText(input.name, 80), file: null, notes: cleanText(input.notes, 4000), credit: null, meta: {}, size: 0, createdAt: now() };
  insertKitItem(item);
  return item;
}

function insertKitItem(i: KitItem) {
  getDb()
    .prepare("INSERT INTO kit_items (id, kind, name, file, notes, credit, meta, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(i.id, i.kind, i.name, i.file, i.notes, i.credit, JSON.stringify(i.meta), i.size, i.createdAt);
}

export function updateKitItem(id: string, patch: { name?: string; notes?: string; credit?: string | null }): KitItem | null {
  const item = getKitItem(id);
  if (!item) return null;
  const next = {
    name: patch.name !== undefined ? cleanText(patch.name, 80) || item.name : item.name,
    notes: patch.notes !== undefined ? cleanText(patch.notes, item.kind === "style" ? 4000 : 2000) : item.notes,
    credit: patch.credit !== undefined ? cleanText(patch.credit, 200) || null : item.credit,
  };
  getDb().prepare("UPDATE kit_items SET name = ?, notes = ?, credit = ? WHERE id = ?").run(next.name, next.notes, next.credit, id);
  return { ...item, ...next };
}

export function deleteKitItem(id: string): boolean {
  const item = getKitItem(id);
  if (!item) return false;
  if (item.file) getStorage().remove(`kit/${item.file}`);
  getDb().prepare("DELETE FROM kit_items WHERE id = ?").run(id);
  return true;
}

export function toPublicKitItem(i: KitItem) {
  return { id: i.id, kind: i.kind, name: i.name, notes: i.notes, credit: i.credit, size: i.size, createdAt: i.createdAt, hasFile: !!i.file, family: i.kind === "font" ? kitFontFamily(i) : undefined, meta: { width: i.meta.width, height: i.meta.height, duration: i.meta.duration, alpha: i.meta.alpha, lutSize: i.meta.lutSize } };
}

/** How the editor should use an item (shown in search results and the turn context). */
export function kitUsage(i: KitItem): string {
  const p = `kit/${i.file}`;
  switch (i.kind) {
    case "font":
      return `In render_animation HTML use font-family:'${kitFontFamily(i)}' (embedded automatically).`;
    case "lut":
      return `run_ffmpeg filter: lut3d=${p}`;
    case "logo":
    case "image":
      return `In render_animation HTML: <img src="${p}"> (inlined automatically), or as an FFmpeg input -i ${p}.`;
    case "overlay":
      return `FFmpeg input -i ${p}${i.meta.alpha ? " (has transparency: overlay=format=auto)" : " (no transparency: use blend=screen/lighten or colorkey)"}; ${Number(i.meta.duration ?? 0).toFixed(1)}s.`;
    case "sfx":
    case "music":
      return `FFmpeg input -i ${p} (${Number(i.meta.duration ?? 0).toFixed(1)}s); mix with adelay/amix.`;
    case "style":
      return "Follow this recipe for the user's edits when it fits the brief.";
  }
}
