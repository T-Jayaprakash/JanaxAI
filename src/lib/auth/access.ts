import { jsonError } from "../http";
import { authEnabled, authReady, LOCAL_WORKSPACE } from "./server";

/** Who is calling, and which workspace their request acts in. */
export interface Access {
  userId: string | null;
  email: string | null;
  name: string | null;
  workspaceId: string;
  workspaceName: string;
  role: "owner" | "admin" | "member";
}

const LOCAL_ACCESS: Access = { userId: null, email: null, name: null, workspaceId: LOCAL_WORKSPACE, workspaceName: "Local studio", role: "owner" };

function slugFor(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "studio";
  return `${base}-${crypto.randomUUID().slice(0, 6)}`;
}

/**
 * The caller's access, or null when they aren't signed in. On first sign-in
 * the user gets a personal workspace; afterwards the session's active
 * workspace is used, re-checked against membership on every request.
 */
export async function getAccess(headers: Headers): Promise<Access | null> {
  if (!authEnabled()) return LOCAL_ACCESS;
  const auth = await authReady();
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  const user = session.user;
  let member = await auth.api.getActiveMember({ headers }).catch(() => null);
  if (!member) {
    const orgs = await auth.api.listOrganizations({ headers }).catch(() => []);
    let orgId = orgs[0]?.id;
    if (!orgId) {
      const name = `${(user.name || user.email.split("@")[0]).slice(0, 40)}'s studio`;
      const created = await auth.api.createOrganization({ body: { name, slug: slugFor(name), userId: user.id } });
      orgId = created?.id;
    }
    if (!orgId) return null;
    await auth.api.setActiveOrganization({ headers, body: { organizationId: orgId } });
    member = await auth.api.getActiveMember({ headers }).catch(() => null);
    if (!member) return null;
  }
  const org = await auth.api.getFullOrganization({ headers, query: { organizationId: member.organizationId } }).catch(() => null);
  return {
    userId: user.id,
    email: user.email,
    name: user.name || null,
    workspaceId: member.organizationId,
    workspaceName: org?.name ?? "Workspace",
    role: (["owner", "admin"].includes(member.role) ? member.role : "member") as Access["role"],
  };
}

/** For route handlers: the caller's access, or a 401 response to return. */
export async function requireAccess(req: Request): Promise<Access | Response> {
  try {
    const access = await getAccess(req.headers);
    return access ?? jsonError(401, "Please sign in to continue.");
  } catch (err) {
    console.error("[auth] couldn't check the session", err);
    return jsonError(503, "Sign-in is temporarily unavailable. Please try again.");
  }
}
