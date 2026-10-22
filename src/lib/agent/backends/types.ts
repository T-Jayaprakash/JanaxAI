import type { ToolOutput } from "../../studio/tools";

export interface AgentTurnInput {
  system: string;
  history: { role: "user" | "assistant"; text: string }[];
  context: string;
  userText: string;
  conversationId: string;
  messageId: string;
  runId: string;
}

export interface AgentCallbacks {
  /** Visible reply text as it streams. */
  onText: (delta: string) => void;
  /** Runs a studio tool in this process (API engine). */
  runTool: (name: string, input: unknown) => Promise<ToolOutput>;
  shouldCancel: () => boolean;
}

export interface AgentBackend {
  id: "anthropic-api" | "claude-code-cli";
  /** Shown in the UI so users know which engine answered. */
  label: string;
  devOnly: boolean;
  run: (input: AgentTurnInput, cb: AgentCallbacks) => Promise<void>;
}

export class AgentError extends Error {
  constructor(public userMessage: string, public diagnostic?: string) {
    super(userMessage);
  }
}
