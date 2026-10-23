import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import * as authRoute from "../src/app/api/auth/[...all]/route";
import * as convRoute from "../src/app/api/conversations/[id]/route";
import * as messagesRoute from "../src/app/api/conversations/[id]/messages/route";
import * as kitItemRoute from "../src/app/api/kit/[id]/route";
import * as kitRoute from "../src/app/api/kit/route";
import { getAccess } from "../src/lib/auth/access";
import { createConversation, getConversation } from "../src/lib/conversations";
import { listKit } from "../src/lib/kit";
import { useTempDataDir } from "./helpers";

const BASE = "http://localhost:3000";
const codes = new Map<string, string>();
const realLog = console.log;

type G = typeof globalThis & { __januxAuth?: unknown; __januxAuthReady?: unknown };

/** Signs in through the real email-code endpoints and returns the session cookie. */
async function signIn(email: string): Promise<string> {
  const send = await authRoute.POST(
    new Request(`${BASE}/api/auth/email-otp/send-verification-otp`, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": email }, body: JSON.stringify({ email, type: "sign-in" }) }),
  );
  assert.equal(send.status, 200, await send.clone().text());
  for (let i = 0; i < 50 && !codes.has(email); i++) await new Promise((r) => setTimeout(r, 20));
  const otp = codes.get(email);
  assert.ok(otp, "a login code was produced");
  const res = await authRoute.POST(
    new Request(`${BASE}/api/auth/sign-in/email-otp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, otp }) }),
  );
  assert.equal(res.status, 200, await res.clone().text());
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.match(cookie, /session_token=/);
  return cookie;
}

const req = (path: string, cookie: string | null, init: RequestInit = {}) =>
  new Request(`${BASE}${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), "content-type": "application/json", ...(init.headers ?? {}) } });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) }) as never;

describe("accounts and workspace isolation", () => {
  let alice = "";
  let bob = "";
  let aliceWs = "";
  let bobWs = "";

  before(async () => {
    useTempDataDir();
    process.env.JANUX_AUTH = "on";
    process.env.BETTER_AUTH_SECRET = "test-secret-".padEnd(48, "x");
    process.env.BETTER_AUTH_URL = BASE;
    (globalThis as G).__januxAuth = undefined;
    (globalThis as G).__januxAuthReady = undefined;
    console.log = (...args: unknown[]) => {
      const m = String(args[0]).match(/^\[auth\] \(dev, email not configured\) sign-in for (\S+): (\d{6})$/);
      if (m) codes.set(m[1], m[2]);
      else realLog(...args);
    };
    alice = await signIn("alice@example.com");
    bob = await signIn("bob@example.com");
  });

  after(() => {
    console.log = realLog;
    delete process.env.JANUX_AUTH;
    (globalThis as G).__januxAuth = undefined;
    (globalThis as G).__januxAuthReady = undefined;
  });

  it("gives each new user their own workspace", async () => {
    const a = await getAccess(new Headers({ cookie: alice }));
    const b = await getAccess(new Headers({ cookie: bob }));
    assert.ok(a && b);
    assert.equal(a.email, "alice@example.com");
    assert.equal(a.role, "owner");
    assert.notEqual(a.workspaceId, b.workspaceId);
    assert.notEqual(a.workspaceId, "local");
    aliceWs = a.workspaceId;
    bobWs = b.workspaceId;
    // Stable across requests.
    assert.equal((await getAccess(new Headers({ cookie: alice })))!.workspaceId, aliceWs);
    assert.equal(await getAccess(new Headers()), null);
  });

  it("refuses requests without a session", async () => {
    const conv = await createConversation(undefined, aliceWs);
    const res = await convRoute.PATCH(req(`/api/conversations/${conv.id}`, null, { method: "PATCH", body: JSON.stringify({ title: "x" }) }), params({ id: conv.id }));
    assert.equal(res.status, 401);
  });

  it("hides one workspace's projects from another", async () => {
    const conv = await createConversation(undefined, aliceWs);
    const rename = (cookie: string) =>
      convRoute.PATCH(req(`/api/conversations/${conv.id}`, cookie, { method: "PATCH", body: JSON.stringify({ title: "Mine" }) }), params({ id: conv.id }));
    assert.equal((await rename(bob)).status, 404);
    assert.equal((await rename(alice)).status, 200);
    const post = await messagesRoute.POST(req(`/api/conversations/${conv.id}/messages`, bob, { method: "POST", body: JSON.stringify({ text: "hi" }) }), params({ id: conv.id }));
    assert.equal(post.status, 404);
    const del = await convRoute.DELETE(req(`/api/conversations/${conv.id}`, bob, { method: "DELETE" }), params({ id: conv.id }));
    assert.equal(del.status, 404);
    assert.ok(await getConversation(conv.id), "still there");
  });

  it("keeps each workspace's kit separate", async () => {
    const cube = `LUT_3D_SIZE 2\n${Array.from({ length: 8 }, () => "0.5 0.5 0.5").join("\n")}\n`;
    const up = await kitRoute.POST(
      req(`/api/kit?kind=lut&fileName=warm.cube&name=Warm&rights=1`, alice, { method: "POST", body: cube, headers: { "content-type": "text/plain" }, duplex: "half" } as RequestInit),
    );
    assert.equal(up.status, 201, await up.clone().text());
    const { item } = (await up.json()) as { item: { id: string } };
    assert.equal((await listKit(aliceWs)).length, 1);
    assert.equal((await listKit(bobWs)).length, 0);
    const bobDelete = await kitItemRoute.DELETE(req(`/api/kit/${item.id}`, bob, { method: "DELETE" }), params({ id: item.id }));
    assert.equal(bobDelete.status, 404);
    assert.equal((await listKit(aliceWs)).length, 1);
  });
});
