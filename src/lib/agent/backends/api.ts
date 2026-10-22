import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { studioToolSchemas } from "../../studio/tools";
import { AgentError, type AgentBackend, type AgentCallbacks, type AgentTurnInput } from "./types";

/**
 * Production engine: the Claude API with native tool use over the studio
 * tools. Needs ANTHROPIC_API_KEY on the server (never in the browser).
 * Frames and contact sheets go back to Claude in tool results so it can see
 * the footage and check its own renders.
 */

const MODEL = process.env.JANUX_MODEL || "claude-opus-5-5";
const MAX_ITERATIONS = 80;

type StreamFactory = (params: Anthropic.Beta.Messages.MessageCreateParamsStreaming) => {
  on: (event: "text", cb: (delta: string) => void) => unknown;
  finalMessage: () => Promise<Anthropic.Beta.Messages.BetaMessage>;
  abort: () => void;
};

let factoryOverride: StreamFactory | null = null;
/** Tests inject a fake stream; production uses the SDK. */
export function setStreamFactoryForTests(f: StreamFactory | null) {
  factoryOverride = f;
}

function defaultFactory(): StreamFactory {
  const client = new Anthropic();
  return (params) => client.beta.messages.stream(params);
}

function tools(): Anthropic.Beta.Messages.BetaToolUnion[] {
  const list: Anthropic.Beta.Messages.BetaToolUnion[] = studioToolSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));
  if (process.env.JANUX_WEB_SEARCH === "on") list.push({ type: "web_search_20260209", name: "web_search", max_uses: 3 });
  return list;
}

export const anthropicApiBackend: AgentBackend = {
  id: "anthropic-api",
  label: `Claude API (${MODEL})`,
  devOnly: false,
  async run(input: AgentTurnInput, cb: AgentCallbacks) {
    const create = factoryOverride ?? defaultFactory();
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      ...input.history.map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.Messages.BetaMessageParam),
      { role: "user", content: [{ type: "text", text: input.context }, { type: "text", text: input.userText || "(no text)" }] },
    ];
    // The API requires the first message to be from the user.
    while (messages.length && messages[0].role !== "user") messages.shift();

    let jsonRetries = 0;
    let wroteAny = false;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (cb.shouldCancel()) throw new AgentError("Stopped.");
      const stream = create({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        tools: tools(),
        messages,
        stream: true,
      });
      let needsBreak = wroteAny;
      stream.on("text", (delta) => {
        if (needsBreak) {
          cb.onText("\n\n");
          needsBreak = false;
        }
        cb.onText(delta);
        wroteAny = true;
      });
      const cancelPoll = setInterval(() => cb.shouldCancel() && stream.abort(), 500);

      let message: Anthropic.Beta.Messages.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (cb.shouldCancel()) throw new AgentError("Stopped.");
        if (err instanceof Anthropic.AuthenticationError) throw new AgentError("The Claude API key is invalid.", err.message);
        if (err instanceof Anthropic.RateLimitError) throw new AgentError("The AI service is busy right now. Please try again in a minute.", err.message);
        if (err instanceof Anthropic.APIError) throw new AgentError("The AI service returned an error. Please try again.", err.message);
        // Unparseable streamed tool input: re-issue the turn a couple of times.
        if (jsonRetries++ >= 2) throw new AgentError("The AI response was malformed. Please try again.", String(err));
        continue;
      } finally {
        clearInterval(cancelPoll);
      }

      if (message.stop_reason === "refusal") {
        cb.onText("\n\nI can't help with that request.");
        return;
      }
      if (message.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: message.content });
        continue;
      }
      const toolUses = message.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) return;
      if (message.stop_reason === "max_tokens") throw new AgentError("The response was too long to finish. Please try a smaller request.");

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const out = await cb.runTool(tu.name, tu.input);
        const content: Anthropic.Beta.Messages.BetaToolResultBlockParam["content"] = [{ type: "text", text: out.text }];
        for (const p of (out.images ?? []).slice(0, 8)) {
          if (!fs.existsSync(p)) continue;
          content.push({ type: "image", source: { type: "base64", media_type: p.endsWith(".png") ? "image/png" : "image/jpeg", data: fs.readFileSync(p).toString("base64") } });
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: !!out.isError });
      }
      messages.push({ role: "user", content: results });
    }
    cb.onText("\n\n(I reached my step limit for this reply. Ask me to continue and I'll pick up from here.)");
  },
};
