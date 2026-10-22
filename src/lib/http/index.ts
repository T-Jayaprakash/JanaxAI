import { connection } from "next/server";

/** JSON error with a user-safe message. */
export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

/** Opts a handler out of prerendering (sync SQLite reads would otherwise run at build time). */
export async function dynamic() {
  await connection();
}

const buckets = new Map<string, { tokens: number; at: number }>();

/**
 * Small in-memory token bucket. Good enough for a single-process prototype;
 * a shared store (e.g. Redis) is needed once there are multiple web servers.
 */
export function rateLimit(req: Request, scope: string, perMinute: number): Response | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local";
  const key = `${scope}:${ip}`;
  const nowMs = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: nowMs };
  b.tokens = Math.min(perMinute, b.tokens + ((nowMs - b.at) / 60_000) * perMinute);
  b.at = nowMs;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return jsonError(429, "You're sending requests too quickly. Please wait a moment.");
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return null;
}
