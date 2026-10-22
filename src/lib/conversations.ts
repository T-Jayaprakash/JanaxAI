import { deleteAssetFiles, getAsset, toPublicAsset, type Asset, type PublicAsset } from "./assets";
import { getDb, newId, now, parseJson } from "./db";
import { listJobs, toPublicJob, type PublicJob } from "./jobs";
import type { EditSpec } from "./spec";
import { getStorage } from "./storage";

export const DEFAULT_TITLE = "New video";

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  text: string;
  attachments: string[];
  jobId: string | null;
  versionId: string | null;
  createdAt: number;
}

export interface Version {
  id: string;
  conversationId: string;
  jobId: string;
  parentVersionId: string | null;
  number: number;
  assetId: string;
  spec: EditSpec;
  duration: number;
  width: number;
  height: number;
  createdAt: number;
}

type Row = Record<string, unknown>;

const convFromRow = (r: Row): Conversation => ({
  id: r.id as string,
  title: r.title as string,
  createdAt: r.created_at as number,
  updatedAt: r.updated_at as number,
});

const msgFromRow = (r: Row): Message => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  role: r.role as Message["role"],
  text: r.text as string,
  attachments: parseJson(r.attachments as string, []),
  jobId: (r.job_id as string) ?? null,
  versionId: (r.version_id as string) ?? null,
  createdAt: r.created_at as number,
});

const versionFromRow = (r: Row): Version => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  jobId: r.job_id as string,
  parentVersionId: (r.parent_version_id as string) ?? null,
  number: r.number as number,
  assetId: r.asset_id as string,
  spec: parseJson(r.spec as string, {} as EditSpec),
  duration: r.duration as number,
  width: r.width as number,
  height: r.height as number,
  createdAt: r.created_at as number,
});

export function createConversation(title = DEFAULT_TITLE): Conversation {
  const t = now();
  const id = newId("cnv");
  getDb().prepare("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, title, t, t);
  return { id, title, createdAt: t, updatedAt: t };
}

export function getConversation(id: string): Conversation | null {
  const r = getDb().prepare("SELECT * FROM conversations WHERE id = ?").get(id) as Row | undefined;
  return r ? convFromRow(r) : null;
}

export function listConversations() {
  const rows = getDb()
    .prepare(
      `SELECT c.*,
        (SELECT COUNT(*) FROM versions v WHERE v.conversation_id = c.id) AS version_count,
        (SELECT v.asset_id FROM versions v WHERE v.conversation_id = c.id ORDER BY v.number DESC LIMIT 1) AS latest_asset,
        (SELECT j.state FROM jobs j WHERE j.conversation_id = c.id ORDER BY j.created_at DESC LIMIT 1) AS latest_job_state
       FROM conversations c ORDER BY c.updated_at DESC`,
    )
    .all() as Row[];
  return rows.map((r) => {
    const latest = r.latest_asset ? getAsset(r.latest_asset as string) : null;
    return {
      ...convFromRow(r),
      versionCount: r.version_count as number,
      latestJobState: (r.latest_job_state as string) ?? null,
      latestThumbnailUrl: latest?.thumbKey ? `/api/assets/${latest.id}/thumbnail` : null,
    };
  });
}

export function renameConversation(id: string, title: string) {
  getDb().prepare("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?").run(title, now(), id);
}

export function touchConversation(id: string) {
  getDb().prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run(now(), id);
}

/** Deletes the conversation, its jobs/messages/versions and every file it owns. */
export function deleteConversation(id: string): boolean {
  const db = getDb();
  if (!getConversation(id)) return false;
  const assets = db.prepare("SELECT id FROM assets WHERE conversation_id = ?").all(id) as { id: string }[];
  for (const { id: assetId } of assets) {
    const a = getAsset(assetId);
    if (a) deleteAssetFiles(a);
  }
  const jobs = db.prepare("SELECT id FROM jobs WHERE conversation_id = ?").all(id) as { id: string }[];
  for (const j of jobs) getStorage().remove(`tmp/${j.id}`);
  db.transaction(() => {
    // Ask any running worker to stop before rows disappear.
    db.prepare("UPDATE jobs SET cancel_requested = 1 WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM assets WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM usage_records WHERE conversation_id = ?").run(id);
    db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
  })();
  return true;
}

export function addMessage(input: Omit<Message, "id" | "createdAt">): Message {
  const msg: Message = { ...input, id: newId("msg"), createdAt: now() };
  getDb()
    .prepare(
      "INSERT INTO messages (id, conversation_id, role, text, attachments, job_id, version_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(msg.id, msg.conversationId, msg.role, msg.text, JSON.stringify(msg.attachments), msg.jobId, msg.versionId, msg.createdAt);
  touchConversation(msg.conversationId);
  return msg;
}

export function setMessageVersion(jobId: string, versionId: string) {
  getDb().prepare("UPDATE messages SET version_id = ? WHERE job_id = ?").run(versionId, jobId);
}

export function listMessages(conversationId: string): Message[] {
  return (getDb().prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid").all(conversationId) as Row[]).map(msgFromRow);
}

export function getVersion(id: string): Version | null {
  const r = getDb().prepare("SELECT * FROM versions WHERE id = ?").get(id) as Row | undefined;
  return r ? versionFromRow(r) : null;
}

export function listVersions(conversationId: string): Version[] {
  return (getDb().prepare("SELECT * FROM versions WHERE conversation_id = ? ORDER BY number").all(conversationId) as Row[]).map(versionFromRow);
}

export function insertVersion(v: Omit<Version, "id" | "number" | "createdAt">): Version {
  const db = getDb();
  return db.transaction(() => {
    const max = db.prepare("SELECT COALESCE(MAX(number), 0) AS n FROM versions WHERE conversation_id = ?").get(v.conversationId) as { n: number };
    const version: Version = { ...v, id: newId("ver"), number: max.n + 1, createdAt: now() };
    db.prepare(
      `INSERT INTO versions (id, conversation_id, job_id, parent_version_id, number, asset_id, spec, duration, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      version.id, version.conversationId, version.jobId, version.parentVersionId, version.number, version.assetId,
      JSON.stringify(version.spec), version.duration, version.width, version.height, version.createdAt,
    );
    return version;
  })();
}

/**
 * The version the user is currently "on": the most recent message that
 * produced or showed a version. Revisions start from it.
 */
export function getBaseVersion(conversationId: string): Version | null {
  const r = getDb()
    .prepare("SELECT version_id FROM messages WHERE conversation_id = ? AND version_id IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(conversationId) as { version_id: string } | undefined;
  return r ? getVersion(r.version_id) : null;
}

export function toPublicVersion(v: Version, asset: Asset | null) {
  return {
    id: v.id,
    jobId: v.jobId,
    parentVersionId: v.parentVersionId,
    number: v.number,
    duration: v.duration,
    width: v.width,
    height: v.height,
    spec: v.spec,
    createdAt: v.createdAt,
    asset: asset ? toPublicAsset(asset) : null,
    downloadUrl: `/api/assets/${v.assetId}/file?download=1`,
  };
}
export type PublicVersion = ReturnType<typeof toPublicVersion>;

export interface ConversationSnapshot {
  conversation: Conversation;
  messages: Message[];
  jobs: PublicJob[];
  versions: PublicVersion[];
  assets: Record<string, PublicAsset>;
}

/** Everything the chat screen needs to restore itself after a refresh. */
export function getSnapshot(id: string): ConversationSnapshot | null {
  const conversation = getConversation(id);
  if (!conversation) return null;
  const messages = listMessages(id);
  const jobs = listJobs(id);
  const versions = listVersions(id);
  const assetIds = new Set<string>();
  for (const m of messages) m.attachments.forEach((a) => assetIds.add(a));
  for (const j of jobs) j.spec.clips?.forEach((c) => assetIds.add(c.assetId));
  for (const v of versions) assetIds.add(v.assetId);
  const assets: Record<string, PublicAsset> = {};
  for (const aid of assetIds) {
    const a = getAsset(aid);
    if (a) assets[aid] = toPublicAsset(a);
  }
  return {
    conversation,
    messages,
    jobs: jobs.map(toPublicJob),
    versions: versions.map((v) => toPublicVersion(v, getAsset(v.assetId))),
    assets,
  };
}
