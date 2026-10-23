import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../config";
import { getDb } from "../db";
import { freeDiskBytes } from "../storage";

/**
 * Intermediate renders (ProRes overlays, frame grabs, contact sheets) are
 * large and only useful while a reply is being made. Delivered videos are
 * already saved as versions, so a workspace's work/ files and frame images
 * can go once the conversation has been idle for a while. Transcripts and
 * analyses in cache/*.json are small and kept, so follow-ups stay fast.
 */

const DISPOSABLE_CACHE = /^(frame|sheet|thumb)-.*\.(jpe?g|png)$/;

function dirSize(dir: string): number {
  let total = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isFile()) total += fs.statSync(p).size;
    else if (e.isDirectory()) total += dirSize(p);
  }
  return total;
}

function lastActivity(dir: string): number {
  let latest = fs.statSync(dir).mtimeMs;
  for (const sub of ["work", "cache"]) {
    const d = path.join(dir, sub);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) latest = Math.max(latest, fs.lstatSync(path.join(d, f)).mtimeMs);
  }
  return latest;
}

/** Returns bytes freed. Never touches a conversation with a reply queued or running. */
export async function sweepWorkspaces(opts: { idleHours?: number } = {}): Promise<{ freed: number; swept: number }> {
  const cfg = getConfig();
  const root = path.join(/*turbopackIgnore: true*/ cfg.dataDir, "workspaces");
  if (!fs.existsSync(root)) return { freed: 0, swept: 0 };
  const lowDisk = (await freeDiskBytes()) < cfg.minFreeDiskBytes * 2;
  // When the disk is nearly full, anything idle for an hour goes.
  const idleMs = (lowDisk ? 1 : (opts.idleHours ?? Number(process.env.JANUX_WORKSPACE_IDLE_HOURS ?? 24))) * 3600_000;
  const db = getDb();
  const busy = new Set((db.prepare("SELECT DISTINCT conversation_id AS id FROM agent_runs WHERE state IN ('queued','running')").all() as { id: string }[]).map((r) => r.id));
  const exists = db.prepare("SELECT 1 FROM conversations WHERE id = ?");
  let freed = 0;
  let swept = 0;
  for (const id of fs.readdirSync(root)) {
    const dir = path.join(root, id);
    if (!/^cnv_[a-z0-9]+$/.test(id) || !fs.lstatSync(dir).isDirectory() || busy.has(id)) continue;
    try {
      if (!exists.get(id)) {
        // The conversation was deleted: the whole workspace goes.
        freed += dirSize(dir);
        fs.rmSync(dir, { recursive: true, force: true });
        swept++;
        continue;
      }
      if (Date.now() - lastActivity(dir) < idleMs) continue;
      let freedHere = 0;
      const work = path.join(dir, "work");
      if (fs.existsSync(work)) {
        freedHere += dirSize(work);
        fs.rmSync(work, { recursive: true, force: true });
        fs.mkdirSync(work);
      }
      const cache = path.join(dir, "cache");
      if (fs.existsSync(cache)) {
        for (const f of fs.readdirSync(cache)) {
          if (!DISPOSABLE_CACHE.test(f)) continue;
          freedHere += fs.statSync(path.join(cache, f)).size;
          fs.rmSync(path.join(cache, f), { force: true });
        }
      }
      if (freedHere) {
        freed += freedHere;
        swept++;
      }
    } catch (err) {
      console.error("[cleanup] workspace sweep failed for", id, err);
    }
  }
  return { freed, swept };
}
