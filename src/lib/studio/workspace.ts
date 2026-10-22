import fs from "node:fs";
import path from "node:path";
import { getAsset, type Asset } from "../assets";
import { getConfig } from "../config";
import { getDb } from "../db";
import { getStorage } from "../storage";

/**
 * Each conversation gets a studio workspace the assistant works in:
 *   in/    read-only links to the user's uploads and earlier outputs (<assetId>.<ext>)
 *   work/  anything the assistant renders while editing
 *   cache/ transcripts and analysis
 * Tools only accept paths inside this folder.
 */
export function workspaceDir(conversationId: string): string {
  if (!/^cnv_[a-f0-9]{32}$/.test(conversationId)) throw new Error("Invalid conversation id");
  return path.join(/*turbopackIgnore: true*/ getConfig().dataDir, "workspaces", conversationId);
}

export function inputName(a: Asset): string {
  return `in/${a.id}${path.extname(a.storageKey)}`;
}

/** Links every asset of the conversation (plus the brand logo) into in/. */
export function syncWorkspace(conversationId: string, extraAssetIds: string[] = []): { dir: string; assets: Asset[] } {
  const dir = workspaceDir(conversationId);
  for (const sub of ["in", "work", "cache"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const ids = (getDb().prepare("SELECT id FROM assets WHERE conversation_id = ? ORDER BY created_at").all(conversationId) as { id: string }[]).map((r) => r.id);
  const storage = getStorage();
  const assets: Asset[] = [];
  for (const id of [...new Set([...ids, ...extraAssetIds])]) {
    const a = getAsset(id);
    if (!a || !storage.exists(a.storageKey)) continue;
    const target = storage.absolutePath(a.storageKey);
    // Originals are read-only so no edit can overwrite them through a link.
    try {
      fs.chmodSync(target, 0o444);
    } catch {}
    const link = path.join(dir, inputName(a));
    if (!fs.existsSync(link)) fs.symlinkSync(target, link);
    assets.push(a);
  }
  return { dir, assets };
}

const SAFE_REL = /^(in|work|cache)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/** Resolves a workspace-relative path, rejecting anything that escapes it. */
export function resolveInWorkspace(conversationId: string, rel: string, opts: { mustExist?: boolean; writable?: boolean } = {}): string {
  const clean = rel.replace(/^\.\//, "");
  if (!SAFE_REL.test(clean) || clean.split("/").includes("..")) {
    throw new Error(`Path "${rel}" must be inside the workspace, like in/<file> or work/<file>.`);
  }
  if (opts.writable && !clean.startsWith("work/")) throw new Error("Outputs must be written under work/.");
  const abs = path.join(workspaceDir(conversationId), clean);
  if (opts.mustExist && !fs.existsSync(abs)) throw new Error(`File "${rel}" doesn't exist.`);
  return abs;
}

export function cleanupWorkspace(conversationId: string) {
  fs.rmSync(workspaceDir(conversationId), { recursive: true, force: true });
}
