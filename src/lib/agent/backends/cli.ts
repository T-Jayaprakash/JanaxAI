import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getConfig } from "../../config";
import { getDb } from "../../db";
import { getStorage } from "../../storage";
import { AgentError, type AgentBackend, type AgentCallbacks, type AgentTurnInput } from "./types";

/**
 * DEVELOPMENT ONLY. Runs the developer's locally installed Claude Code CLI
 * (`claude -p`), signed in with their own Claude plan, so they can test
 * JANUXAI end to end on their own machine. It must never serve other people;
 * production uses the Claude API engine. Claude Code's built-in tools are
 * disabled: the only tools are JANUXAI's studio tools, served over MCP by
 * worker/mcp-studio.ts for this one reply.
 */

/** Process groups of running CLI replies, so the worker can stop them on exit. */
const activeGroups = new Set<number>();

export function killProcessGroup(pid: number) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

export function killActiveCliProcesses() {
  for (const pid of activeGroups) killProcessGroup(pid);
  activeGroups.clear();
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

function mcpConfig(input: AgentTurnInput): string {
  const root = process.cwd();
  const tsx = path.join(root, "node_modules", ".bin", "tsx");
  const env: Record<string, string> = {
    JANUX_CONVERSATION_ID: input.conversationId,
    JANUX_MESSAGE_ID: input.messageId,
    JANUX_RUN_ID: input.runId,
    JANUX_DATA_DIR: getConfig().dataDir,
  };
  for (const k of ["PATH", "HOME", "TMPDIR", "FFMPEG_PATH", "FFPROBE_PATH", "CHROME_PATH", "WHISPER_CLI", "WHISPER_MODEL", "JANUX_FFMPEG_TIMEOUT_SEC", "JANUX_MIN_FREE_DISK_MB"]) {
    if (process.env[k]) env[k] = process.env[k]!;
  }
  return JSON.stringify({ mcpServers: { janux: { type: "stdio", command: tsx, args: [path.join(root, "worker", "mcp-studio.ts")], env } } });
}

export const claudeCliBackend: AgentBackend = {
  id: "claude-code-cli",
  label: "Claude via your local Claude Code login (development only)",
  devOnly: true,
  run(input: AgentTurnInput, cb: AgentCallbacks) {
    const bin = claudeCliPath();
    if (!bin) throw new AgentError("The local Claude Code CLI wasn't found. Install Claude Code or set CLAUDE_CLI_PATH.");
    // An empty working directory so no project instructions are picked up.
    const cwd = getStorage().ensureDir("tmp/agent-cli");
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;
    delete env.ANTHROPIC_API_KEY; // this engine intentionally uses the developer's own login
    // Renders and transcriptions can take many minutes; don't let the CLI time the tools out.
    env.MCP_TOOL_TIMEOUT = String(60 * 60_000);
    const args = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--tools", "",
      "--mcp-config", mcpConfig(input),
      "--strict-mcp-config",
      "--allowedTools", "mcp__janux",
      "--max-turns", "80",
      "--no-session-persistence",
      "--model", process.env.JANUX_CLI_MODEL || "opus",
      "--system-prompt", input.system,
    ];
    return new Promise<void>((resolve, reject) => {
      // Own process group: killing it also stops the MCP server and any FFmpeg it started.
      const child = spawn(/*turbopackIgnore: true*/ bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"], detached: true });
      const pid = child.pid;
      if (pid) {
        activeGroups.add(pid);
        void getDb().run("UPDATE agent_runs SET pid = ? WHERE id = ?", [pid, input.runId]);
      }
      const stop = () => pid && killProcessGroup(pid);
      let buffer = "";
      let wroteAny = false;
      let needsBreak = false;
      let errorText: string | null = null;
      let gotResult = false;
      let stderr = "";
      const timer = setTimeout(stop, 45 * 60_000);
      const cancelPoll = setInterval(() => cb.shouldCancel() && stop(), 500);

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
            // Separate text written before and after tool calls.
            if (e?.type === "message_start" && wroteAny) needsBreak = true;
            if (e?.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
              if (needsBreak) {
                cb.onText("\n\n");
                needsBreak = false;
              }
              cb.onText(e.delta.text);
              wroteAny = true;
            }
          } else if (evt.type === "result") {
            gotResult = true;
            if (evt.is_error && evt.subtype !== "error_max_turns") errorText = String(evt.result ?? evt.subtype ?? "error");
            if (evt.subtype === "error_max_turns") cb.onText("\n\n(I reached my step limit for this reply. Ask me to continue and I'll pick up from here.)");
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
        if (pid) activeGroups.delete(pid);
        if (cb.shouldCancel()) return reject(new AgentError("Stopped."));
        if (errorText) {
          const limited = /limit|quota|usage/i.test(errorText);
          return reject(
            new AgentError(limited ? "Your Claude plan's usage limit was reached. Try again after it resets." : "The AI engine returned an error. Please try again.", errorText),
          );
        }
        if (!gotResult && code !== 0) {
          const auth = /log ?in|auth/i.test(stderr);
          return reject(new AgentError(auth ? "The local Claude Code CLI isn't logged in. Run `claude` once and sign in." : "The AI engine stopped unexpectedly.", stderr));
        }
        resolve();
      });
      child.stdin.end(formatPrompt(input));
    });
  },
};
