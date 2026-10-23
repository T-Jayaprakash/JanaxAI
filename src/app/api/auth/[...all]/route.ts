import { authEnabled, authReady } from "@/lib/auth/server";
import { jsonError, rateLimit } from "@/lib/http";

/** Better Auth endpoints: email codes, Google sign-in, sessions and workspaces. */
async function handle(req: Request) {
  if (!authEnabled()) return jsonError(404, "Accounts are turned off on this server.");
  // Code requests are rate-limited per client on top of Better Auth's own limits.
  if (new URL(req.url).pathname.endsWith("/send-verification-otp")) {
    const limited = rateLimit(req, "auth-otp", 5);
    if (limited) return limited;
  }
  const auth = await authReady();
  return auth.handler(req);
}

export const GET = handle;
export const POST = handle;
