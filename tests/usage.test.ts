import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { addMessage, createConversation } from "../src/lib/conversations";
import { getDb, newId } from "../src/lib/db";
import { monthStartIST, SESSION_MS, sessionStart, usageReport, weekStartIST } from "../src/lib/usage";
import { useTempDataDir } from "./helpers";

const H = 3600_000;

describe("usage meters", () => {
  it("starts a 5-hour session at the first request and a new one after it ends", async () => {
    const t0 = Date.UTC(2026, 9, 23, 4, 0);
    assert.equal(sessionStart([], t0), null);
    assert.equal(sessionStart([t0, t0 + H], t0 + 2 * H), t0);
    assert.equal(sessionStart([t0, t0 + H], t0 + 6 * H), null, "the session expired with no new request");
    assert.equal(sessionStart([t0, t0 + H, t0 + 5.5 * H], t0 + 6 * H), t0 + 5.5 * H, "a request after expiry starts a new session");
  });

  it("uses Monday 12:00 AM and the 1st of the month in IST", async () => {
    // Thursday 23 Oct 2026, 10:00 IST.
    const now = Date.UTC(2026, 9, 23, 4, 30);
    assert.equal(new Date(weekStartIST(now)).toISOString(), "2026-10-18T18:30:00.000Z");
    // Sunday 11:30 PM IST still belongs to the week that started Monday.
    assert.equal(weekStartIST(Date.UTC(2026, 9, 25, 18, 0)), weekStartIST(now));
    const m = monthStartIST(now);
    assert.equal(new Date(m.start).toISOString(), "2026-09-30T18:30:00.000Z");
    assert.equal(new Date(m.next).toISOString(), "2026-10-31T18:30:00.000Z");
  });

  describe("report", () => {
    before(() => useTempDataDir());

    it("counts requests the assistant worked on, against the plan's limits", async () => {
      const conv = (await createConversation()).id;
      const now = Date.now();
      const insert = async (at: number, attempts: number, state: string) => {
        const msg = await addMessage({ conversationId: conv, role: "assistant", text: "", attachments: [], jobId: null, versionId: null });
        await getDb().run("INSERT INTO agent_runs (id, conversation_id, message_id, state, provider, attempts, created_at, updated_at) VALUES (?, ?, ?, ?, 'test', ?, ?, ?)", [
          newId("run"), conv, msg.id, state, attempts, at, at,
        ]);
      };
      await insert(now - 2 * H, 1, "done");
      await insert(now - H, 1, "failed");
      await insert(now - 0.5 * H, 0, "cancelled"); // stopped before it started: not counted
      process.env.JANUX_PLAN = "basic";
      const r = await usageReport(now);
      assert.equal(r.plan.name, "Basic");
      assert.equal(r.enforced, false);
      const session = r.meters.find((m) => m.id === "session")!;
      assert.equal(session.used, 2);
      assert.equal(session.limit, 10);
      assert.equal(session.resetsAt, now - 2 * H + SESSION_MS);
      assert.equal(r.meters.find((m) => m.id === "exports")!.limit, 5);
      process.env.JANUX_PLAN = "pro";
      assert.equal((await usageReport(now)).meters.find((m) => m.id === "weekly")!.limit, 400);
      assert.equal((await usageReport(now)).meters.find((m) => m.id === "exports")!.limit, null);
      delete process.env.JANUX_PLAN;
    });
  });
});
