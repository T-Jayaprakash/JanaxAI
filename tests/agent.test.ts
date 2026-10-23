import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, describe, it } from "node:test";
import { ingestUpload } from "../src/lib/assets";
import { anthropicApiBackend, setStreamFactoryForTests } from "../src/lib/agent/backends/api";
import { historyTurns, turnContext } from "../src/lib/agent/context";
import { selectBackend } from "../src/lib/agent/provider";
import { getBrandKit } from "../src/lib/brand";
import { addMessage, createConversation, getVersion } from "../src/lib/conversations";
import { probe } from "../src/lib/media/probe";
import { checkFfmpegArgs } from "../src/lib/studio/ffmpegGuard";
import { runStudioTool, type StudioContext } from "../src/lib/studio/tools";
import { inputName, resolveInWorkspace } from "../src/lib/studio/workspace";
import { fileChunks, fixtures, useTempDataDir } from "./helpers";

type FakeMessage = { content: unknown[]; stop_reason: string };

/** Minimal stand-in for the SDK's MessageStream. */
function fakeFactory(script: FakeMessage[], seen: unknown[]) {
  let i = 0;
  return (params: unknown) => {
    seen.push(structuredClone(params));
    const msg = script[i++];
    const listeners: ((d: string) => void)[] = [];
    return {
      on: (_e: "text", cb: (d: string) => void) => listeners.push(cb),
      finalMessage: async () => {
        for (const b of msg.content as { type: string; text?: string }[]) if (b.type === "text") listeners.forEach((l) => l(b.text!));
        return msg as never;
      },
      abort: () => undefined,
    };
  };
}

describe("ffmpeg guard", () => {
  const ok = (args: string[]) => checkFfmpegArgs(args);
  const bad = (args: string[]) => assert.throws(() => checkFfmpegArgs(args));

  it("allows normal workspace edits and finds outputs", async () => {
    const plan = ok(["-i", "in/a.mp4", "-vf", "scale=1080:-2", "-c:v", "libx264", "work/out.mp4"]);
    assert.deepEqual(plan.outputs, ["work/out.mp4"]);
    assert.deepEqual(plan.inputs, ["in/a.mp4"]);
    assert.ok(plan.args.includes("-protocol_whitelist"));
    ok(["-f", "lavfi", "-i", "color=c=black:s=1080x1920:d=2", "work/bg.mp4"]);
    ok(["-i", "work/a.mp4", "-metadata:s:v", "title=x", "work/b.mp4"]);
  });

  it("blocks network, outside paths, file-reading filters and overwriting inputs", async () => {
    bad(["-i", "https://evil.example/x.mp4", "work/o.mp4"]);
    bad(["-i", "/etc/passwd", "work/o.mp4"]);
    bad(["-i", "in/../../secret.mp4", "work/o.mp4"]);
    bad(["-i", "in/a.mp4", "-vf", "movie=/etc/passwd", "work/o.mp4"]);
    bad(["-i", "in/a.mp4", "in/a.mp4"]);
    bad(["-i", "in/a.mp4", "/tmp/out.mp4"]);
    bad(["-f", "concat", "-safe", "0", "-i", "work/list.txt", "work/o.mp4"]);
    bad(["-i", "in/a.mp4", "-filter_complex_script", "work/f.txt", "work/o.mp4"]);
  });
});

describe("studio tools", () => {
  let ctx: StudioContext;
  let clipRel: string;
  before(async () => {
    useTempDataDir();
    const conversationId = (await createConversation()).id;
    const msg = await addMessage({ conversationId, role: "assistant", text: "", attachments: [], jobId: null, versionId: null });
    ctx = { conversationId, messageId: msg.id, runId: "run_test", shouldCancel: () => false };
    const fx = fixtures();
    const a = await ingestUpload({ body: fileChunks(fx.landscapeWithAudio), originalName: "clip.mp4", mime: "video/mp4", conversationId });
    clipRel = inputName(a);
  });

  it("lists media and keeps paths inside the workspace", async () => {
    const out = await runStudioTool("list_media", {}, ctx);
    assert.match(out.text, /clip\.mp4/);
    assert.throws(() => resolveInWorkspace(ctx.conversationId, "../../etc/passwd"));
    assert.throws(() => resolveInWorkspace(ctx.conversationId, "in/x.mp4", { writable: true }));
  });

  it("inspects video as a contact sheet image", async () => {
    const out = await runStudioTool("inspect_media", { path: clipRel, frames: 8 }, ctx);
    assert.equal(out.isError, undefined, out.text);
    assert.equal(out.images?.length, 1);
    assert.ok(fs.existsSync(out.images![0]));
  });

  it("runs an edit, renders a transparent overlay, composites, and delivers", async () => {
    const cut = await runStudioTool(
      "run_ffmpeg",
      { purpose: "Cut and reframe", args: ["-i", clipRel, "-t", "2", "-vf", "scale=-2:640,crop=360:640,fps=30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "work/cut.mp4"] },
      ctx,
    );
    assert.ok(!cut.isError, cut.text);
    const anim = await runStudioTool(
      "render_animation",
      {
        html: `<div id=c style="position:absolute;bottom:80px;width:100%;text-align:center;font:800 40px sans-serif;color:#ff0"></div>
          <script>const w=[["Hello",0],["🔥 World",1]];window.__januxSeek=t=>{document.getElementById('c').textContent=(w.filter(x=>x[1]<=t).pop()||[""])[0]}</script>`,
        width: 360,
        height: 640,
        duration: 2,
        fps: 15,
        transparent: true,
        output: "work/caps.mov",
      },
      ctx,
    );
    assert.ok(!anim.isError, anim.text);
    const comp = await runStudioTool(
      "run_ffmpeg",
      { purpose: "Add captions", args: ["-i", "work/cut.mp4", "-i", "work/caps.mov", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto[v]", "-map", "[v]", "-map", "0:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", "work/final.mp4"] },
      ctx,
    );
    assert.ok(!comp.isError, comp.text);
    const del = await runStudioTool("deliver", { path: "work/final.mp4", title: "Test reel" }, ctx);
    assert.ok(!del.isError, del.text);
    const info = await probe(path.join(path.dirname(resolveInWorkspace(ctx.conversationId, "work/x")), "final.mp4"));
    assert.equal(info.width, 360);
    assert.match(del.text, /version 1/);
  });

  it("generates sound effects and (on macOS) voiceovers", async () => {
    const sfx = await runStudioTool("generate_sound_effect", { type: "whoosh", output: "work/whoosh.wav" }, ctx);
    assert.ok(!sfx.isError, sfx.text);
    const vo = await runStudioTool("generate_voiceover", { text: "Welcome to the shop.", language: "en", output: "work/vo.m4a" }, ctx);
    if (process.platform === "darwin") assert.ok(!vo.isError, vo.text);
    else assert.equal(vo.isError, true);
    const wrongExt = await runStudioTool("generate_sound_effect", { type: "pop", output: "work/pop.mp3" }, ctx);
    assert.equal(wrongExt.isError, true);
  });

  it("rejects bad input without running anything", async () => {
    const out = await runStudioTool("run_ffmpeg", { purpose: "x", args: ["-i", "/etc/hosts", "work/o.mp4"] }, ctx);
    assert.equal(out.isError, true);
    const unknown = await runStudioTool("rm_rf", {}, ctx);
    assert.equal(unknown.isError, true);
  });
});

describe("agent", () => {
  let conversationId: string;
  let messageId: string;
  before(async () => {
    useTempDataDir();
    conversationId = (await createConversation()).id;
    messageId = (await addMessage({ conversationId, role: "assistant", text: "", attachments: [], jobId: null, versionId: null })).id;
  });

  it("is off in rules mode and refuses the CLI engine in production", async () => {
    assert.equal(selectBackend(), null);
    const env = { ...process.env };
    process.env.JANUX_AI = "claude-cli";
    (process.env as Record<string, string>).NODE_ENV = "production";
    assert.equal(selectBackend(), null);
    process.env.JANUX_AI = env.JANUX_AI;
    (process.env as Record<string, string | undefined>).NODE_ENV = env.NODE_ENV;
  });

  it("runs a tool-use loop on the API engine and streams the final text", async () => {
    const seen: unknown[] = [];
    setStreamFactoryForTests(
      fakeFactory(
        [
          {
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Saving your channel name." },
              { type: "tool_use", id: "toolu_1", name: "update_brand_kit", input: { businessName: "Trichy Vlogs" } },
            ],
          },
          { stop_reason: "end_turn", content: [{ type: "text", text: "Done! Send me your raw footage." }] },
        ],
        seen,
      ),
    );
    let text = "";
    await anthropicApiBackend.run(
      { system: "sys", history: [{ role: "assistant", text: "earlier" }], context: "<context/>", userText: "hi", conversationId, messageId, runId: "run_x" },
      {
        onText: (d) => (text += d),
        runTool: (name, input) => runStudioTool(name, input, { conversationId, messageId, runId: "run_x", shouldCancel: () => false }),
        shouldCancel: () => false,
      },
    );
    setStreamFactoryForTests(null);
    assert.equal((await getBrandKit()).businessName, "Trichy Vlogs");
    assert.match(text, /Saving your channel name\.\n\nDone!/);
    const first = seen[0] as { messages: { role: string }[]; fallbacks: string; betas: string[]; tools: { name: string; eager_input_streaming?: boolean }[] };
    assert.equal(first.messages[0].role, "user", "history never starts with an assistant turn");
    assert.equal(first.fallbacks, "default");
    assert.ok(first.betas.includes("server-side-fallback-2026-07-01"));
    assert.ok(first.tools.some((t) => t.name === "run_ffmpeg") && first.tools.every((t) => t.eager_input_streaming));
    const second = seen[1] as { messages: { role: string; content: { type: string; is_error?: boolean }[] }[] };
    assert.equal(second.messages.at(-1)!.content[0].type, "tool_result");
  });

  it("builds context with brand kit and workspace paths", async () => {
    await addMessage({ conversationId, role: "user", text: "hello", attachments: [], jobId: null, versionId: null });
    const ctxText = await turnContext(conversationId);
    assert.match(ctxText, /Trichy Vlogs/);
    assert.match(ctxText, /IST/);
    assert.equal((await historyTurns(conversationId, "none")).at(-1)!.text, "hello");
    assert.equal(await getVersion("ver_missing"), null);
  });
});
