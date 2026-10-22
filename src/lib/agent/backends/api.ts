import Anthropic from "@anthropic-ai/sdk";
import { actionJsonSchemas, previewBase64 } from "../actions";
import { actionLabel } from "./cli";
import { AgentError, type AgentBackend, type AgentCallbacks, type AgentTurnInput } from "./types";

/**
 * Production backend: the Claude API with native tool use. Needs
 * ANTHROPIC_API_KEY on the server (never in the browser). Rendered design
 * previews are returned to Claude in tool results so it can check its work.
 */

const MODEL = process.env.JANUX_MODEL || "claude-opus-5-5";
const MAX_ITERATIONS = 8;

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
  const custom: Anthropic.Beta.Messages.BetaToolUnion[] = actionJsonSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.Messages.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));
  if (process.env.JANUX_WEB_SEARCH === "on") {
    custom.push({ type: "web_search_20260209", name: "web_search", max_uses: 3 });
  }
  return custom;
}

export const anthropicApiBackend: AgentBackend = {
  id: "anthropic-api",
  label: `Claude API (${MODEL})`,
  devOnly: false,
  async run(input: AgentTurnInput, cb: AgentCallbacks) {
    const create = factoryOverride ?? defaultFactory();
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
      ...input.history.map((t) => ({ role: t.role, content: t.text }) as Anthropic.Beta.Messages.BetaMessageParam),
      {
        role: "user",
        content: [
          { type: "text", text: input.context },
          { type: "text", text: input.userText || "(no text)" },
        ],
      },
    ];
    // The API requires the first message to be from the user.
    while (messages.length && messages[0].role !== "user") messages.shift();

    let jsonRetries = 0;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (cb.shouldCancel()) throw new AgentError("Stopped.");
      const stream = create({
        model: MODEL,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        tools: tools(),
        messages,
        stream: true,
      });
      stream.on("text", (delta) => cb.onText(delta));
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
      if (message.stop_reason === "max_tokens") throw new AgentError("The response was too long to finish. Try asking for fewer slides at once.");

      messages.push({ role: "assistant", content: message.content });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const label = actionLabel(tu.name, tu.input);
        cb.onActivity(label, "running");
        const outcome = await cb.runAction(tu.name, tu.input);
        cb.onActivity(outcome.ok ? label : `${label}: ${outcome.summary}`, outcome.ok ? "done" : "failed");
        const content: Anthropic.Beta.Messages.BetaToolResultBlockParam["content"] = [{ type: "text", text: outcome.summary }];
        for (const p of (outcome.previewPaths ?? []).slice(0, 4)) {
          content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: previewBase64(p) } });
        }
        results.push({ type: "tool_result", tool_use_id: tu.id, content, is_error: !outcome.ok });
      }
      messages.push({ role: "user", content: results });
      cb.onText("\n\n");
    }
  },
};
