import { getConversation, listMessages } from "../conversations";
import { getDb, newId, now, parseJson } from "../db";
import { executeAction } from "./actions";
import { AgentError } from "./backends/types";
import { historyTurns, readMeta, SYSTEM_PROMPT, turnContext, userTextWithVoice, type MessageMeta } from "./context";
import { selectBackend } from "./provider";

export interface AgentRun {
  id: string;
  conversationId: string;
  messageId: string;
  state: "queued" | "running" | "done" | "failed" | "cancelled";
  provider: string;
  attempts: number;
}

type Row = Record<string, unknown>;
const fromRow = (r: Row): AgentRun => ({
  id: r.id as string,
  conversationId: r.conversation_id as string,
  messageId: r.message_id as string,
  state: r.state as AgentRun["state"],
  provider: r.provider as string,
  attempts: r.attempts as number,
});

export function queueAgentRun(conversationId: string, messageId: string, provider: string): AgentRun {
  const t = now();
  const id = newId("run");
  getDb()
    .prepare("INSERT INTO agent_runs (id, conversation_id, message_id, state, provider, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)")
    .run(id, conversationId, messageId, provider, t, t);
  return { id, conversationId, messageId, state: "queued", provider, attempts: 0 };
}

export function claimNextAgentRun(): AgentRun | null {
  const t = now();
  const r = getDb()
    .prepare(
      `UPDATE agent_runs SET state = 'running', attempts = attempts + 1, updated_at = ?
       WHERE id = (SELECT id FROM agent_runs WHERE state = 'queued' ORDER BY created_at LIMIT 1) AND state = 'queued'
       RETURNING *`,
    )
    .get(t) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function cancelAgentRunForMessage(messageId: string) {
  getDb().prepare("UPDATE agent_runs SET state = 'cancelled', updated_at = ? WHERE message_id = ? AND state IN ('queued','running')").run(now(), messageId);
}

function isCancelled(runId: string) {
  const r = getDb().prepare("SELECT state FROM agent_runs WHERE id = ?").get(runId) as { state: string } | undefined;
  return !r || r.state === "cancelled";
}

/** Runs that were mid-flight when the worker stopped are marked failed (replies aren't safely resumable). */
export function recoverInterruptedAgentRuns() {
  const stuck = getDb().prepare("SELECT * FROM agent_runs WHERE state = 'running'").all() as Row[];
  for (const r of stuck) {
    const run = fromRow(r);
    getDb().prepare("UPDATE agent_runs SET state = 'failed', error = 'worker stopped', updated_at = ? WHERE id = ?").run(now(), run.id);
    const meta = readMeta(run.messageId);
    writeMessage(run.messageId, null, { ...meta, status: "error", error: "The assistant was interrupted. Please send your message again." });
  }
  return stuck.length;
}

function writeMessage(messageId: string, text: string | null, meta: MessageMeta) {
  if (text === null) {
    getDb().prepare("UPDATE messages SET meta = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(meta), now(), messageId);
  } else {
    getDb().prepare("UPDATE messages SET text = ?, meta = ?, updated_at = ? WHERE id = ?").run(text, JSON.stringify(meta), now(), messageId);
  }
}

/** Executes one assistant reply: stream text, run actions, record results. */
export async function processAgentRun(run: AgentRun): Promise<void> {
  const backend = selectBackend();
  const conv = getConversation(run.conversationId);
  if (!conv) return;
  let text = "";
  let meta: MessageMeta = { ...readMeta(run.messageId), status: "streaming", provider: backend?.label, activity: [], designs: [], jobIds: [] };
  let lastWrite = 0;
  const flush = (force = false) => {
    if (force || Date.now() - lastWrite > 250) {
      writeMessage(run.messageId, text, meta);
      lastWrite = Date.now();
    }
  };
  flush(true);

  try {
    if (!backend) throw new AgentError("No AI engine is configured. Add ANTHROPIC_API_KEY, or install Claude Code for local testing.");
    // The user's message is the one right before this reply.
    const msgs = listMessages(run.conversationId);
    const idx = msgs.findIndex((m) => m.id === run.messageId);
    const userMsg = idx > 0 ? msgs[idx - 1] : null;
    const history = historyTurns(run.conversationId, run.messageId).slice(0, userMsg ? -1 : undefined);
    await backend.run(
      { system: SYSTEM_PROMPT, history, context: turnContext(run.conversationId), userText: userMsg ? userTextWithVoice(userMsg) : "" },
      {
        onText: (d) => {
          text += d;
          flush();
        },
        onActivity: (label, status) => {
          const activity = [...(meta.activity ?? [])];
          const i = activity.findIndex((a) => a.status === "running" && (a.label === label || label.startsWith(a.label)));
          if (i >= 0 && status !== "running") activity[i] = { label, status };
          else activity.push({ label, status });
          meta = { ...meta, activity };
          flush(true);
        },
        runAction: async (name, input) => {
          const outcome = await executeAction(name, input, { conversationId: run.conversationId, planner: { label: backend.label, usesAI: true } });
          if (outcome.design) meta = { ...meta, designs: [...(meta.designs ?? []), outcome.design] };
          if (outcome.jobId) meta = { ...meta, jobIds: [...(meta.jobIds ?? []), outcome.jobId] };
          flush(true);
          return outcome;
        },
        shouldCancel: () => isCancelled(run.id),
      },
    );
    if (!text.trim() && !meta.designs?.length && !meta.jobIds?.length) text = "Done.";
    meta = { ...meta, status: "done" };
    flush(true);
    getDb().prepare("UPDATE agent_runs SET state = 'done', updated_at = ? WHERE id = ? AND state = 'running'").run(now(), run.id);
  } catch (err) {
    const cancelled = isCancelled(run.id);
    const userMessage = err instanceof AgentError ? err.userMessage : "Something went wrong while I was working on that.";
    if (!(err instanceof AgentError)) console.error("[agent] run failed", err);
    else if (err.diagnostic) console.error("[agent]", userMessage, err.diagnostic.slice(0, 500));
    meta = { ...meta, status: cancelled ? "done" : "error", error: cancelled ? undefined : userMessage };
    if (cancelled && !text) text = "(stopped)";
    flush(true);
    getDb()
      .prepare("UPDATE agent_runs SET state = ?, error = ?, updated_at = ? WHERE id = ?")
      .run(cancelled ? "cancelled" : "failed", userMessage, now(), run.id);
  }
}

export function parseMessageMeta(raw: string | null | undefined): MessageMeta {
  return parseJson<MessageMeta>(raw, {});
}
