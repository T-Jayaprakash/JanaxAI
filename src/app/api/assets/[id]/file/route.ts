import { requireAccess } from "@/lib/auth/access";
import { getAsset } from "@/lib/assets";
import { dynamic, jsonError } from "@/lib/http";
import { streamFile } from "@/lib/http/files";
import { getStorage } from "@/lib/storage";

/** Serves an asset to members of the workspace that owns it. */
export async function GET(req: Request, ctx: RouteContext<"/api/assets/[id]/file">) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const asset = /^ast_[a-f0-9]{32}$/.test(id) ? await getAsset(id) : null;
  const storage = getStorage();
  if (!asset || asset.workspaceId !== access.workspaceId || !storage.exists(asset.storageKey)) return jsonError(404, "File not found.");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return streamFile(req, storage.absolutePath(asset.storageKey), {
    mime: asset.mime,
    downloadName: download ? asset.originalName : undefined,
  });
}
