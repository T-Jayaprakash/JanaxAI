import { requireAccess } from "@/lib/auth/access";
import { deleteAssetFiles, getAsset } from "@/lib/assets";
import { getDb } from "@/lib/db";
import { jsonError } from "@/lib/http";

/** Removes an upload the user detached before sending. Sent attachments are kept with their conversation. */
export async function DELETE(req: Request, ctx: RouteContext<"/api/assets/[id]">) {
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const asset = /^ast_[a-f0-9]{32}$/.test(id) ? await getAsset(id) : null;
  if (!asset || asset.workspaceId !== access.workspaceId) return jsonError(404, "File not found.");
  const used = await getDb().get("SELECT 1 FROM messages WHERE attachments LIKE ? LIMIT 1", [`%"${id}"%`]);
  if (asset.kind !== "upload" || used) return jsonError(409, "This file is part of a conversation and can't be removed on its own.");
  deleteAssetFiles(asset);
  await getDb().run("DELETE FROM assets WHERE id = ?", [id]);
  return Response.json({ deleted: true });
}
