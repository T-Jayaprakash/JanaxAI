import { deleteAssetFiles, getAsset, getAssets, toPublicAsset, type Asset, type PublicAsset } from "./assets";
import { getDb, newId, now, parseJson, type Row } from "./db";
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
  /** Assistant reply state, activity, designs and job ids (see agent/context.ts). */
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
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
  meta: parseJson(r.meta as string, {}),
  createdAt: r.created_at as number,
  updatedAt: (r.updated_at as number) || (r.created_at as number),
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

export async function createConversation(title = DEFAULT_TITLE): Promise<Conversation> {
  const t = now();
  const id = newId("cnv");
  await getDb().run("INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)", [id, title, t, t]);
  return { id, title, createdAt: t, updatedAt: t };
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const r = await getDb().get("SELECT * FROM conversations WHERE id = ?", [id]);
  return r ? convFromRow(r) : null;
}

export async function listConversations() {
  const rows = await getDb().all(
    `SELECT c.*,
      (SELECT COUNT(*) FROM versions v WHERE v.conversation_id = c.id) AS version_count,
      (SELECT v.asset_id FROM versions v WHERE v.conversation_id = c.id ORDER BY v.number DESC LIMIT 1) AS latest_asset,
      (SELECT j.state FROM jobs j WHERE j.conversation_id = c.id ORDER BY j.created_at DESC LIMIT 1) AS latest_job_state
     FROM conversations c ORDER BY c.updated_at DESC`,
  );
  return Promise.all(
    rows.map(async (r) => {
      const latest = r.latest_asset ? await getAsset(r.latest_asset as string) : null;
      return {
        ...convFromRow(r),
        versionCount: Number(r.version_count),
        latestJobState: (r.latest_job_state as string) ?? null,
        latestThumbnailUrl: latest?.thumbKey ? `/api/assets/${latest.id}/thumbnail` : null,
      };
    }),
  );
}

export async function renameConversation(id: string, title: string) {
  await getDb().run("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?", [title, now(), id]);
}

export async function touchConversation(id: string) {
  await getDb().run("UPDATE conversations SET updated_at = ? WHERE id = ?", [now(), id]);
}

/** Deletes the conversation, its jobs/messages/versions and every file it owns. */
export async function deleteConversation(id: string): Promise<boolean> {
  const db = getDb();
  if (!(await getConversation(id))) return false;
  const assets = await db.all<{ id: string }>("SELECT id FROM assets WHERE conversation_id = ?", [id]);
  for (const { id: assetId } of assets) {
    const a = await getAsset(assetId);
    if (a) deleteAssetFiles(a);
  }
  const jobs = await db.all<{ id: string }>("SELECT id FROM jobs WHERE conversation_id = ?", [id]);
  for (const j of jobs) getStorage().remove(`tmp/${j.id}`);
  await db.tx(async (q) => {
    // Ask any running worker to stop before rows disappear.
    await q.run("UPDATE jobs SET cancel_requested = 1 WHERE conversation_id = ?", [id]);
    await q.run("DELETE FROM assets WHERE conversation_id = ?", [id]);
    await q.run("DELETE FROM usage_records WHERE conversation_id = ?", [id]);
    await q.run("DELETE FROM conversations WHERE id = ?", [id]);
  });
  return true;
}

export async function addMessage(input: Omit<Message, "id" | "createdAt" | "updatedAt" | "meta"> & { meta?: Record<string, unknown> }): Promise<Message> {
  const t = now();
  const msg: Message = { ...input, meta: input.meta ?? {}, id: newId("msg"), createdAt: t, updatedAt: t };
  await getDb().run(
    "INSERT INTO messages (id, conversation_id, role, text, attachments, job_id, version_id, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [msg.id, msg.conversationId, msg.role, msg.text, JSON.stringify(msg.attachments), msg.jobId, msg.versionId, JSON.stringify(msg.meta), t, t],
  );
  await touchConversation(msg.conversationId);
  return msg;
}

export async function setMessageVersion(jobId: string, versionId: string) {
  // Rule-planner messages link one job via job_id; AI messages list jobs in meta.
  await getDb().run("UPDATE messages SET version_id = ?, updated_at = ? WHERE job_id = ? OR (job_id IS NULL AND meta LIKE ?)", [versionId, now(), jobId, `%"${jobId}"%`]);
}

export async function messagesUpdatedSince(conversationId: string, since: number): Promise<Message[]> {
  return (await getDb().all("SELECT * FROM messages WHERE conversation_id = ? AND updated_at > ? ORDER BY updated_at", [conversationId, since])).map(msgFromRow);
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  return (await getDb().all("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, id", [conversationId])).map(msgFromRow);
}

export async function getVersion(id: string): Promise<Version | null> {
  const r = await getDb().get("SELECT * FROM versions WHERE id = ?", [id]);
  return r ? versionFromRow(r) : null;
}

export async function listVersions(conversationId: string): Promise<Version[]> {
  return (await getDb().all("SELECT * FROM versions WHERE conversation_id = ? ORDER BY number", [conversationId])).map(versionFromRow);
}

export async function insertVersion(v: Omit<Version, "id" | "number" | "createdAt">): Promise<Version> {
  return getDb().tx(async (q) => {
    // Lock the conversation row so two renders can't take the same version number.
    if (getDb().dialect === "postgres") await q.get("SELECT id FROM conversations WHERE id = ? FOR UPDATE", [v.conversationId]);
    const max = (await q.get<{ n: number }>("SELECT COALESCE(MAX(number), 0) AS n FROM versions WHERE conversation_id = ?", [v.conversationId]))!;
    const version: Version = { ...v, id: newId("ver"), number: Number(max.n) + 1, createdAt: now() };
    await q.run(
      `INSERT INTO versions (id, conversation_id, job_id, parent_version_id, number, asset_id, spec, duration, width, height, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [version.id, version.conversationId, version.jobId, version.parentVersionId, version.number, version.assetId, JSON.stringify(version.spec), version.duration, version.width, version.height, version.createdAt],
    );
    return version;
  });
}

/**
 * The version the user is currently "on": the most recent message that
 * produced or showed a version. Revisions start from it.
 */
export async function getBaseVersion(conversationId: string): Promise<Version | null> {
  const rows = await getDb().all<{ version_id: string }>(
    "SELECT version_id FROM messages WHERE conversation_id = ? AND version_id IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT 50",
    [conversationId],
  );
  // Motion graphics are versions too, but only clip edits can be revised.
  for (const r of rows) {
    const v = await getVersion(r.version_id);
    if (v && Array.isArray(v.spec.clips)) return v;
  }
  return null;
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
export async function getSnapshot(id: string): Promise<ConversationSnapshot | null> {
  const conversation = await getConversation(id);
  if (!conversation) return null;
  const [messages, jobs, versions] = await Promise.all([listMessages(id), listJobs(id), listVersions(id)]);
  const assetIds = new Set<string>();
  for (const m of messages) {
    m.attachments.forEach((a) => assetIds.add(a));
    for (const d of (m.meta.designs as { assetIds: string[] }[] | undefined) ?? []) d.assetIds.forEach((a) => assetIds.add(a));
  }
  for (const j of jobs) j.spec.clips?.forEach((c) => assetIds.add(c.assetId));
  for (const v of versions) assetIds.add(v.assetId);
  const found = await getAssets([...assetIds]);
  const assets: Record<string, PublicAsset> = {};
  for (const a of found) assets[a.id] = toPublicAsset(a);
  const byId = new Map(found.map((a) => [a.id, a]));
  return {
    conversation,
    messages,
    jobs: jobs.map(toPublicJob),
    versions: versions.map((v) => toPublicVersion(v, byId.get(v.assetId) ?? null)),
    assets,
  };
}
