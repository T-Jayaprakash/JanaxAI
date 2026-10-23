import { getDb, now, parseJson } from "../db";
import type { MessageMeta } from "./context";

/**
 * Reply metadata is written by two processes (the worker streaming text and
 * the studio tool server reporting steps), so every change is a short
 * read-modify-write in a transaction that locks the row (IMMEDIATE on
 * SQLite, SELECT ... FOR UPDATE on Postgres).
 */
export async function patchMeta(messageId: string, fn: (m: MessageMeta) => MessageMeta): Promise<MessageMeta> {
  const db = getDb();
  const lock = db.dialect === "postgres" ? " FOR UPDATE" : "";
  return db.tx(async (q) => {
    const r = await q.get<{ meta: string }>(`SELECT meta FROM messages WHERE id = ?${lock}`, [messageId]);
    const next = fn(parseJson<MessageMeta>(r?.meta, {}));
    await q.run("UPDATE messages SET meta = ?, updated_at = ? WHERE id = ?", [JSON.stringify(next), now(), messageId]);
    return next;
  });
}

export async function writeReplyText(messageId: string, text: string) {
  await getDb().run("UPDATE messages SET text = ?, updated_at = ? WHERE id = ?", [text, now(), messageId]);
}

export async function addActivity(messageId: string, label: string): Promise<number> {
  let index = 0;
  // Remember how much of the reply was written when this step began.
  const row = await getDb().get<{ n: number }>("SELECT length(text) AS n FROM messages WHERE id = ?", [messageId]);
  const at = Number(row?.n ?? 0);
  await patchMeta(messageId, (m) => {
    const activity = [...(m.activity ?? []), { label, status: "running" as const, at }];
    index = activity.length - 1;
    return { ...m, activity };
  });
  return index;
}

export async function updateActivity(messageId: string, index: number, patch: { progress?: number; detail?: string }) {
  await patchMeta(messageId, (m) => {
    const activity = [...(m.activity ?? [])];
    if (activity[index]) activity[index] = { ...activity[index], ...patch };
    return { ...m, activity };
  });
}

export async function finishActivity(
  messageId: string,
  index: number,
  status: "done" | "failed",
  label?: string,
  extra: { images?: string[]; detail?: string } = {},
) {
  await patchMeta(messageId, (m) => {
    const activity = [...(m.activity ?? [])];
    if (activity[index]) activity[index] = { ...activity[index], label: label ?? activity[index].label, status, progress: undefined, ...extra };
    return { ...m, activity };
  });
}
