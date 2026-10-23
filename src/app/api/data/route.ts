import { requireAccess } from "@/lib/auth/access";
import { deleteConversation, listConversations } from "@/lib/conversations";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/http";
import { getStorage } from "@/lib/storage";
import { getAsset, deleteAssetFiles } from "@/lib/assets";

/** Deletes every conversation, upload and render in the caller's workspace. Owners and admins only. */
export async function DELETE(req: Request) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  if (access.role === "member") return jsonError(403, "Only workspace owners and admins can delete all data.");
  for (const c of await listConversations(access.workspaceId)) await deleteConversation(c.id);
  const db = getDb();
  // Uploads that were never sent in a message.
  for (const { id } of await db.all<{ id: string }>("SELECT id FROM assets WHERE workspace_id = ?", [access.workspaceId])) {
    const a = await getAsset(id);
    if (a) deleteAssetFiles(a);
  }
  await db.run("DELETE FROM assets WHERE workspace_id = ?", [access.workspaceId]);
  getStorage().ensureDir("tmp");
  return Response.json({ deleted: true });
}
