import { deleteConversation, listConversations } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getAsset, deleteAssetFiles } from "@/lib/assets";

/** Deletes every conversation, upload, render and usage record. */
export async function DELETE() {
  for (const c of await listConversations()) await deleteConversation(c.id);
  const db = getDb();
  // Uploads that were never sent in a message.
  for (const { id } of await db.all<{ id: string }>("SELECT id FROM assets")) {
    const a = await getAsset(id);
    if (a) deleteAssetFiles(a);
  }
  await db.run("DELETE FROM assets");
  await db.run("DELETE FROM usage_records");
  getStorage().ensureDir("tmp");
  return Response.json({ deleted: true });
}
