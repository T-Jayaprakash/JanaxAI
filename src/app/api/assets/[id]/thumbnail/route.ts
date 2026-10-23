import { requireAccess } from "@/lib/auth/access";
import { getAsset } from "@/lib/assets";
import { dynamic, jsonError } from "@/lib/http";
import { streamFile } from "@/lib/http/files";
import { getStorage } from "@/lib/storage";

export async function GET(req: Request, ctx: RouteContext<"/api/assets/[id]/thumbnail">) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  const asset = /^ast_[a-f0-9]{32}$/.test(id) ? await getAsset(id) : null;
  const storage = getStorage();
  if (!asset?.thumbKey || asset.workspaceId !== access.workspaceId || !storage.exists(asset.thumbKey)) return jsonError(404, "Thumbnail not found.");
  return streamFile(req, storage.absolutePath(asset.thumbKey), { mime: "image/jpeg", cache: "private, max-age=86400, immutable" });
}
