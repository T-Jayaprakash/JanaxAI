import { spawn } from "node:child_process";
import fs from "node:fs";
import { getStorage } from "../../storage";
import { actionJsonSchemas } from "../actions";
import { AgentError, type AgentBackend, type AgentCallbacks, type AgentTurnInput } from "./types";

/**
 * DEVELOPMENT ONLY. Runs the developer's locally installed Claude Code CLI
 * (`claude -p`), which uses their own Claude subscription login. It exists so
 * the developer can test JANUXAI end to end on their own machine. It must
 * never serve other people: production uses the Claude API backend with an
 * API key. Claude Code tools are disabled; the model can only reply in text
 * and request JANUXAI actions through a fenced JSON block that we validate.
 */

const ACTIONS_FENCE = "```janux-actions";

function protocolAppendix(): string {
  return `

# How to take actions in this environment
There is no tool calling here. To run actions, end your reply with exactly one fenced block, after your message to the user:
${ACTIONS_FENCE}
[{"action": "<name>", "input": { ... }}]
\`\`\`
The block is hidden from the user and executed after your message, so describe what you are making ("I'm creating your poster now") rather than claiming it is finished. The JSON must be valid: escape double quotes and newlines inside HTML strings (or use single quotes in HTML attributes). Leave the block out when no action is needed.

Action input schemas (JSON Schema):
${JSON.stringify(actionJsonSchemas())}`;
}

export function claudeCliPath(): string | null {
  const configured = process.env.CLAUDE_CLI_PATH;
  if (configured) return fs.existsSync(configured) ? configured : null;
  const home = process.env.HOME ?? "";
  const candidates = [`${home}/.local/bin/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

function formatPrompt(input: AgentTurnInput): string {
  const history = input.history.map((t) => `${t.role === "user" ? "User" : "JANUXAI"}: ${t.text}`).join("\n\n");
  return [
    history ? `<conversation_so_far>\n${history}\n</conversation_so_far>` : "",
    input.context,
    `The user's new message:\n${input.userText}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface CliResult {
  text: string;
}

function runCli(system: string, prompt: string, onDelta: ((d: string) => void) | null, shouldCancel: () => boolean): Promise<CliResult> {
  const bin = claudeCliPath();
  if (!bin) throw new AgentError("The local Claude Code CLI wasn't found. Install Claude Code or set CLAUDE_CLI_PATH.");
  // An empty working directory so no project instructions are picked up.
  const cwd = getStorage().ensureDir("tmp/agent-cli");
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  delete env.ANTHROPIC_API_KEY; // this backend intentionally uses the developer's own login
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--tools", "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--model", process.env.JANUX_CLI_MODEL || "opus",
    "--system-prompt", system,
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let streamed = "";
    let finalText: string | null = null;
    let errorText: string | null = null;
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 10 * 60_000);
    const cancelPoll = setInterval(() => shouldCancel() && child.kill("SIGKILL"), 500);

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let evt: Record<string, unknown>;
        try {
          evt = JSON.parse(line);
        } catch {
          continue;
        }
        if (evt.type === "stream_event") {
          const e = evt.event as { type?: string; delta?: { type?: string; text?: string } };
          if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
            streamed += e.delta.text;
            onDelta?.(e.delta.text);
          }
        } else if (evt.type === "result") {
          if (evt.is_error) errorText = String(evt.result ?? evt.subtype ?? "error");
          else finalText = typeof evt.result === "string" ? evt.result : streamed;
        }
      }
    });
    child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
    child.on("error", (err) => {
      clearTimeout(timer);
      clearInterval(cancelPoll);
      reject(new AgentError("Couldn't start the local Claude Code CLI.", err.message));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearInterval(cancelPoll);
      if (shouldCancel()) return reject(new AgentError("Stopped."));
      if (errorText) {
        const limited = /limit|quota|usage/i.test(errorText);
        return reject(
          new AgentError(
            limited ? "Your Claude plan's usage limit was reached. Try again after it resets." : "The AI engine returned an error. Please try again.",
            errorText,
          ),
        );
      }
      if (finalText === null && code !== 0) {
        const auth = /log ?in|auth/i.test(stderr);
        return reject(new AgentError(auth ? "The local Claude Code CLI isn't logged in. Run `claude` once and sign in." : "The AI engine stopped unexpectedly.", stderr));
      }
      resolve({ text: finalText ?? streamed });
    });
    child.stdin.end(prompt);
  });
}

export function splitActions(text: string): { visible: string; actionsJson: string | null } {
  const i = text.indexOf(ACTIONS_FENCE);
  if (i < 0) return { visible: text.trim(), actionsJson: null };
  const rest = text.slice(i + ACTIONS_FENCE.length);
  const end = rest.lastIndexOf("```");
  return { visible: text.slice(0, i).trim(), actionsJson: (end >= 0 ? rest.slice(0, end) : rest).trim() };
}

function parseActions(json: string): { action: string; input: unknown }[] {
  const data = JSON.parse(json) as unknown;
  const list = Array.isArray(data) ? data : [data];
  return list.map((a) => {
    const item = a as { action?: unknown; input?: unknown };
    if (typeof item.action !== "string") throw new Error("Each action needs an \"action\" name.");
    return { action: item.action, input: item.input ?? {} };
  });
}

export const claudeCliBackend: AgentBackend = {
  id: "claude-code-cli",
  label: "Claude via your local Claude Code login (development only)",
  devOnly: true,
  async run(input: AgentTurnInput, cb: AgentCallbacks) {
    const system = input.system + protocolAppendix();
    let visibleSent = 0;
    let full = "";
    let announced = false;
    // Stream only the text before the hidden actions block.
    const onDelta = (d: string) => {
      full += d;
      const cut = full.indexOf(ACTIONS_FENCE);
      if (cut >= 0 && !announced) {
        announced = true;
        cb.onActivity("Preparing the work", "running");
      }
      // Hold back a few characters in case the fence is arriving.
      const safeEnd = cut >= 0 ? cut : Math.max(visibleSent, full.length - ACTIONS_FENCE.length);
      if (safeEnd > visibleSent) {
        cb.onText(full.slice(visibleSent, safeEnd));
        visibleSent = safeEnd;
      }
    };
    const { text } = await runCli(system, formatPrompt(input), onDelta, cb.shouldCancel);
    const { visible, actionsJson } = splitActions(text);
    if (visible.length > visibleSent) cb.onText(visible.slice(visibleSent));
    if (announced) cb.onActivity("Preparing the work", actionsJson ? "done" : "failed");
    if (!actionsJson) return;

    let actions: { action: string; input: unknown }[];
    try {
      actions = parseActions(actionsJson);
    } catch (err) {
      // One repair attempt: ask for just the corrected JSON.
      cb.onActivity("Fixing the action format", "running");
      const repair = await runCli(
        system,
        `Your previous reply's ${ACTIONS_FENCE} block was not valid JSON (${err instanceof Error ? err.message : err}). Reply with only the corrected block, nothing else.\n\nThe invalid block:\n${actionsJson.slice(0, 60_000)}`,
        null,
        cb.shouldCancel,
      );
      const fixed = splitActions(repair.text).actionsJson ?? repair.text;
      try {
        actions = parseActions(fixed.replace(/^```(json)?|```$/g, "").trim());
        cb.onActivity("Fixing the action format", "done");
      } catch {
        cb.onActivity("Fixing the action format", "failed");
        throw new AgentError("I planned the work but couldn't turn it into a valid action. Please ask again.", actionsJson.slice(0, 2000));
      }
    }
    for (const a of actions.slice(0, 5)) {
      const label = actionLabel(a.action, a.input);
      cb.onActivity(label, "running");
      const outcome = await cb.runAction(a.action, a.input);
      cb.onActivity(outcome.ok ? label : `${label}: ${outcome.summary}`, outcome.ok ? "done" : "failed");
    }
  },
};

export function actionLabel(name: string, input: unknown): string {
  const title = (input as { title?: string } | null)?.title;
  switch (name) {
    case "create_design":
      return `Designing ${title ? `“${title}”` : "your design"}`;
    case "create_motion_graphic":
      return `Animating ${title ? `“${title}”` : "your motion graphic"}`;
    case "edit_video":
      return "Setting up the video edit";
    case "update_brand_kit":
      return "Saving your brand details";
    default:
      return name;
  }
}
