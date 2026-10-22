import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { executeAction } from "../src/lib/agent/actions";
import { anthropicApiBackend, setStreamFactoryForTests } from "../src/lib/agent/backends/api";
import { splitActions } from "../src/lib/agent/backends/cli";
import { historyTurns, turnContext } from "../src/lib/agent/context";
import { selectBackend } from "../src/lib/agent/provider";
import { getBrandKit } from "../src/lib/brand";
import { addMessage, createConversation } from "../src/lib/conversations";
import { useTempDataDir } from "./helpers";

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

describe("agent", () => {
  let conversationId: string;
  before(() => {
    useTempDataDir();
    conversationId = createConversation().id;
  });

  it("is off in rules mode and refuses the CLI engine in production", () => {
    assert.equal(selectBackend(), null);
    const env = { ...process.env };
    process.env.JANUX_AI = "claude-cli";
    (process.env as Record<string, string>).NODE_ENV = "production";
    assert.equal(selectBackend(), null);
    process.env.JANUX_AI = env.JANUX_AI;
    (process.env as Record<string, string | undefined>).NODE_ENV = env.NODE_ENV;
  });

  it("validates action input before running anything", async () => {
    const bad = await executeAction("create_design", { kind: "poster", format: "2:3", title: "x", slides: [] }, { conversationId, planner: { label: "t", usesAI: true } });
    assert.equal(bad.ok, false);
    const unknown = await executeAction("rm_rf", {}, { conversationId, planner: { label: "t", usesAI: true } });
    assert.equal(unknown.ok, false);
    const noClips = await executeAction("edit_video", { aspect: "9:16" }, { conversationId, planner: { label: "t", usesAI: true } });
    assert.equal(noClips.ok, false, "edit without clips or a base version is rejected");
  });

  it("runs a tool-use loop on the API engine and streams the final text", async () => {
    const seen: unknown[] = [];
    setStreamFactoryForTests(
      fakeFactory(
        [
          {
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Saving your details." },
              { type: "tool_use", id: "toolu_1", name: "update_brand_kit", input: { businessName: "Trichy Sweets", phone: "98765 43210" } },
            ],
          },
          { stop_reason: "end_turn", content: [{ type: "text", text: "Done! Want a poster next?" }] },
        ],
        seen,
      ),
    );
    let text = "";
    const activity: string[] = [];
    await anthropicApiBackend.run(
      { system: "sys", history: [{ role: "assistant", text: "earlier reply" }], context: "<context/>", userText: "My bakery is Trichy Sweets" },
      {
        onText: (d) => (text += d),
        onActivity: (label, status) => activity.push(`${status}:${label}`),
        runAction: (name, input) => executeAction(name, input, { conversationId, planner: { label: "t", usesAI: true } }),
        shouldCancel: () => false,
      },
    );
    setStreamFactoryForTests(null);
    assert.equal(getBrandKit().businessName, "Trichy Sweets");
    assert.match(text, /Saving your details\.[\s\S]*Done! Want a poster next\?/);
    assert.deepEqual(activity, ["running:Saving your brand details", "done:Saving your brand details"]);
    const first = seen[0] as { messages: { role: string }[]; fallbacks: string; betas: string[]; tools: { name: string; eager_input_streaming?: boolean }[] };
    assert.equal(first.messages[0].role, "user", "history never starts with an assistant turn");
    assert.equal(first.fallbacks, "default");
    assert.ok(first.betas.includes("server-side-fallback-2026-07-01"));
    assert.ok(first.tools.every((t) => t.eager_input_streaming));
    const second = seen[1] as { messages: { role: string; content: { type: string; is_error?: boolean }[] }[] };
    const result = second.messages.at(-1)!.content[0];
    assert.equal(result.type, "tool_result");
    assert.equal(result.is_error, false);
  });

  it("separates the hidden CLI action block from visible text", () => {
    const { visible, actionsJson } = splitActions('Making it now!\n\n```janux-actions\n[{"action":"update_brand_kit","input":{"tagline":"Fresh"}}]\n```');
    assert.equal(visible, "Making it now!");
    assert.deepEqual(JSON.parse(actionsJson!), [{ action: "update_brand_kit", input: { tagline: "Fresh" } }]);
    assert.deepEqual(splitActions("Just text"), { visible: "Just text", actionsJson: null });
  });

  it("builds context with brand kit, assets and voice transcripts", () => {
    const user = addMessage({ conversationId, role: "user", text: "hello", attachments: [], jobId: null, versionId: null });
    const ctx = turnContext(conversationId);
    assert.match(ctx, /Trichy Sweets/);
    assert.match(ctx, /IST/);
    const turns = historyTurns(conversationId, "none");
    assert.equal(turns.at(-1)!.text, "hello");
    assert.ok(user.id);
  });
});
