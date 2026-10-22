import { anthropicApiBackend } from "./backends/api";
import { claudeCliBackend, claudeCliPath } from "./backends/cli";
import type { AgentBackend } from "./backends/types";

/**
 * JANUX_AI chooses the assistant engine:
 *   auto (default) - Claude API if ANTHROPIC_API_KEY is set, otherwise the
 *                    local Claude Code CLI in development, otherwise none
 *   api            - Claude API only
 *   claude-cli     - local Claude Code CLI (development only)
 *   rules          - no AI; the keyword planner handles video edits
 * The CLI backend is refused when NODE_ENV=production: a personal Claude
 * login must never serve other people.
 */
export function selectBackend(): AgentBackend | null {
  const mode = (process.env.JANUX_AI || "auto").toLowerCase();
  const production = process.env.NODE_ENV === "production";
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const cliOk = !production && !!claudeCliPath();
  if (mode === "rules") return null;
  if (mode === "api") return hasKey ? anthropicApiBackend : null;
  if (mode === "claude-cli") {
    if (production) console.warn("[janux] JANUX_AI=claude-cli is ignored in production.");
    return cliOk ? claudeCliBackend : null;
  }
  if (hasKey) return anthropicApiBackend;
  if (cliOk) return claudeCliBackend;
  return null;
}
