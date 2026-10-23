import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { queueAgentRun } from "../src/lib/agent/run";
import { createConversation } from "../src/lib/conversations";
import { sweepWorkspaces } from "../src/lib/studio/cleanup";
import { workspaceDir } from "../src/lib/studio/workspace";
import { useTempDataDir } from "./helpers";

function seed(id: string, ageHours: number) {
  const dir = workspaceDir(id);
  for (const sub of ["work", "cache"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const files = ["work/overlay.mov", "cache/frame-1-0.jpg", "cache/words-a.json"].map((f) => path.join(dir, f));
  for (const f of files) fs.writeFileSync(f, Buffer.alloc(2048));
  const t = new Date(Date.now() - ageHours * 3600_000);
  for (const p of [...files, path.join(dir, "work"), path.join(dir, "cache"), dir]) fs.utimesSync(p, t, t);
  return dir;
}

describe("workspace sweep", () => {
  before(async () => {
    useTempDataDir();
    process.env.JANUX_MIN_FREE_DISK_MB = "1";
  });

  it("clears intermediates of idle conversations but keeps transcripts and busy ones", async () => {
    const idle = (await createConversation()).id;
    const fresh = (await createConversation()).id;
    const busy = (await createConversation()).id;
    const idleDir = seed(idle, 48);
    const freshDir = seed(fresh, 1);
    const busyDir = seed(busy, 48);
    await queueAgentRun(busy, "msg_x", "rules");
    const orphanDir = seed("cnv_" + "0".repeat(32), 1);

    const r = await sweepWorkspaces({ idleHours: 24 });
    assert.ok(r.freed >= 4096 * 2, String(r.freed));
    assert.equal(fs.existsSync(path.join(idleDir, "work/overlay.mov")), false);
    assert.equal(fs.existsSync(path.join(idleDir, "cache/frame-1-0.jpg")), false);
    assert.equal(fs.existsSync(path.join(idleDir, "cache/words-a.json")), true);
    assert.equal(fs.existsSync(path.join(idleDir, "work")), true);
    assert.equal(fs.existsSync(path.join(freshDir, "work/overlay.mov")), true);
    assert.equal(fs.existsSync(path.join(busyDir, "work/overlay.mov")), true);
    assert.equal(fs.existsSync(orphanDir), false);
  });
});
