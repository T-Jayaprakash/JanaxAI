import { deleteConversation, listConversations } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getAsset, deleteAssetFiles } from "@/lib/assets";

/** Deletes every conversation, upload, render and usage record. */
export async function DELETE() {
  for (const c of listConversations()) deleteConversation(c.id);
  const db = getDb();
  // Uploads that were never sent in a message.
  for (const { id } of db.prepare("SELECT id FROM assets").all() as { id: string }[]) {
    const a = getAsset(id);
    if (a) deleteAssetFiles(a);
  }
  db.prepare("DELETE FROM assets").run();
  db.prepare("DELETE FROM usage_records").run();
  getStorage().ensureDir("tmp");
  return Response.json({ deleted: true });
}
