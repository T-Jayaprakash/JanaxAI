import { getDb, now, parseJson } from "../db";
import type { MessageMeta } from "./context";

/**
 * Reply metadata is written by two processes (the worker streaming text and
 * the studio tool server reporting steps), so every change is a short
 * read-modify-write inside an IMMEDIATE transaction.
 */
export function patchMeta(messageId: string, fn: (m: MessageMeta) => MessageMeta): MessageMeta {
  const db = getDb();
  return db
    .transaction(() => {
      const r = db.prepare("SELECT meta FROM messages WHERE id = ?").get(messageId) as { meta: string } | undefined;
      const next = fn(parseJson<MessageMeta>(r?.meta, {}));
      db.prepare("UPDATE messages SET meta = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(next), now(), messageId);
      return next;
    })
    .immediate();
}

export function writeReplyText(messageId: string, text: string) {
  getDb().prepare("UPDATE messages SET text = ?, updated_at = ? WHERE id = ?").run(text, now(), messageId);
}

export function addActivity(messageId: string, label: string): number {
  let index = 0;
  patchMeta(messageId, (m) => {
    const activity = [...(m.activity ?? []), { label, status: "running" as const }];
    index = activity.length - 1;
    return { ...m, activity };
  });
  return index;
}

export function finishActivity(messageId: string, index: number, status: "done" | "failed", label?: string) {
  patchMeta(messageId, (m) => {
    const activity = [...(m.activity ?? [])];
    if (activity[index]) activity[index] = { label: label ?? activity[index].label, status };
    return { ...m, activity };
  });
}
