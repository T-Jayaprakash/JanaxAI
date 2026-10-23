import { requireAccess } from "@/lib/auth/access";
import { dynamic } from "@/lib/http";
import { usageReport } from "@/lib/usage";

/** Measured usage against the plan's limits, for the usage meters. */
export async function GET(req: Request) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  return Response.json(await usageReport(access.workspaceId));
}
