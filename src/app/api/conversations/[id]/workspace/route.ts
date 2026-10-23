import fs from "node:fs";
import { requireAccess } from "@/lib/auth/access";
import { getConversationIn } from "@/lib/conversations";
import { dynamic, jsonError } from "@/lib/http";
import { streamFile } from "@/lib/http/files";
import { resolveInWorkspace } from "@/lib/studio/workspace";

/** Serves the frames and contact sheets the editor looked at, for the step thumbnails. */
export async function GET(req: Request, ctx: RouteContext<"/api/conversations/[id]/workspace">) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const { id } = await ctx.params;
  if (!(await getConversationIn(access.workspaceId, id))) return jsonError(404, "Conversation not found.");
  const rel = new URL(req.url).searchParams.get("path") ?? "";
  if (!/^cache\/[A-Za-z0-9._-]+\.(jpe?g|png)$/.test(rel)) return jsonError(400, "Only preview images can be opened.");
  let file: string;
  try {
    file = resolveInWorkspace(id, rel, { mustExist: true });
  } catch {
    return jsonError(404, "Image not found.");
  }
  if (!fs.statSync(file).isFile()) return jsonError(404, "Image not found.");
  return streamFile(req, file, { mime: rel.endsWith(".png") ? "image/png" : "image/jpeg", cache: "private, max-age=86400, immutable" });
}
