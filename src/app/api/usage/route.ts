import { dynamic } from "@/lib/http";
import { usageReport } from "@/lib/usage";

/** Measured usage against the plan's limits, for the usage meters. */
export async function GET() {
  await dynamic();
  return Response.json(usageReport());
}
