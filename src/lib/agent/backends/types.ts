import type { ActionOutcome } from "../actions";

export interface AgentTurnInput {
  system: string;
  history: { role: "user" | "assistant"; text: string }[];
  context: string;
  userText: string;
}

export interface AgentCallbacks {
  /** Visible reply text as it streams. */
  onText: (delta: string) => void;
  onActivity: (label: string, status: "running" | "done" | "failed") => void;
  runAction: (name: string, input: unknown) => Promise<ActionOutcome>;
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
