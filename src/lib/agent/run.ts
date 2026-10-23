import { getConversation, listMessages } from "../conversations";
import { getDb, newId, now, parseJson } from "../db";
import { runStudioTool } from "../studio/tools";
import { syncWorkspace } from "../studio/workspace";
import { patchMeta, writeReplyText } from "./meta";
import { AgentError } from "./backends/types";
import { historyTurns, readMeta, SYSTEM_PROMPT, turnContext, userTextWithVoice, type MessageMeta } from "./context";
import { selectBackend } from "./provider";
import { killProcessGroup } from "./backends/cli";
import { watchCancel } from "../cancel";

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

export async function queueAgentRun(conversationId: string, messageId: string, provider: string): Promise<AgentRun> {
  const t = now();
  const id = newId("run");
  await getDb().run("INSERT INTO agent_runs (id, conversation_id, message_id, state, provider, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?, ?)", [id, conversationId, messageId, provider, t, t]);
  return { id, conversationId, messageId, state: "queued", provider, attempts: 0 };
}

export async function claimNextAgentRun(): Promise<AgentRun | null> {
  const t = now();
  const db = getDb();
  const lock = db.dialect === "postgres" ? " FOR UPDATE SKIP LOCKED" : "";
  const r = await db.get(
    `UPDATE agent_runs SET state = 'running', attempts = attempts + 1, updated_at = ?
     WHERE id = (
       SELECT q.id FROM agent_runs q
       WHERE q.state = 'queued'
         -- One reply at a time per conversation: a follow-up waits for the current reply.
         AND NOT EXISTS (SELECT 1 FROM agent_runs r WHERE r.conversation_id = q.conversation_id AND r.state = 'running')
       ORDER BY q.created_at LIMIT 1${lock}
     ) AND state = 'queued'
     RETURNING *`,
    [t],
  );
  return r ? fromRow(r) : null;
}

export async function cancelAgentRunForMessage(messageId: string) {
  await getDb().run("UPDATE agent_runs SET state = 'cancelled', updated_at = ? WHERE message_id = ? AND state IN ('queued','running')", [now(), messageId]);
}

async function isCancelled(runId: string) {
  const r = await getDb().get<{ state: string }>("SELECT state FROM agent_runs WHERE id = ?", [runId]);
  return !r || r.state === "cancelled";
}

/** Runs that were mid-flight when the worker stopped are marked failed (replies aren't safely resumable). */
export async function recoverInterruptedAgentRuns() {
  const stuck = await getDb().all("SELECT * FROM agent_runs WHERE state = 'running'");
  for (const r of stuck) {
    const run = fromRow(r);
    // A CLI reply can outlive a crashed worker; stop it so it doesn't keep working.
    if (r.pid != null) killProcessGroup(Number(r.pid));
    await getDb().run("UPDATE agent_runs SET state = 'failed', error = 'worker stopped', updated_at = ? WHERE id = ?", [now(), run.id]);
    await patchMeta(run.messageId, (m) => ({ ...m, status: "error", error: "The assistant was interrupted. Please send your message again." }));
  }
  return stuck.length;
}

/** Executes one assistant reply: stream text while Claude works with the studio tools. */
export async function processAgentRun(run: AgentRun): Promise<void> {
  const backend = selectBackend();
  const conv = await getConversation(run.conversationId);
  if (!conv) return;
  let text = "";
  let lastWrite = 0;
  // Writes are chained so a slow one can never land after a newer one.
  let writing: Promise<unknown> = Promise.resolve();
  const flushText = (force = false) => {
    if (force || Date.now() - lastWrite > 250) {
      const snapshot = text;
      writing = writing.then(() => writeReplyText(run.messageId, snapshot)).catch((err) => console.error("[agent] couldn't save reply text", err));
      lastWrite = Date.now();
    }
    return writing;
  };
  const cancel = watchCancel(() => isCancelled(run.id));
  await patchMeta(run.messageId, (m) => ({ ...m, status: "streaming", provider: backend?.label, activity: [], deliveries: [] }));

  try {
    if (!backend) throw new AgentError("No AI engine is configured. Add ANTHROPIC_API_KEY, or install Claude Code for local testing.");
    await syncWorkspace(run.conversationId);
    // The user's message is the one right before this reply.
    const msgs = await listMessages(run.conversationId);
    const idx = msgs.findIndex((m) => m.id === run.messageId);
    const userMsg = idx > 0 ? msgs[idx - 1] : null;
    const history = (await historyTurns(run.conversationId, run.messageId)).slice(0, userMsg ? -1 : undefined);
    const shouldCancel = cancel.shouldCancel;
    await backend.run(
      {
        system: SYSTEM_PROMPT,
        history,
        context: await turnContext(run.conversationId),
        userText: userMsg ? await userTextWithVoice(userMsg) : "",
        conversationId: run.conversationId,
        messageId: run.messageId,
        runId: run.id,
      },
      {
        onText: (d) => {
          text += d;
          flushText();
        },
        runTool: (name, input) => runStudioTool(name, input, { conversationId: run.conversationId, messageId: run.messageId, runId: run.id, shouldCancel }),
        shouldCancel,
      },
    );
    const meta = await readMeta(run.messageId);
    if (!text.trim() && !meta.deliveries?.length) text = "Done.";
    await flushText(true);
    await patchMeta(run.messageId, (m) => ({ ...m, status: "done" }));
    await getDb().run("UPDATE agent_runs SET state = 'done', updated_at = ? WHERE id = ? AND state = 'running'", [now(), run.id]);
  } catch (err) {
    const cancelled = await isCancelled(run.id);
    const userMessage = err instanceof AgentError ? err.userMessage : "Something went wrong while I was working on that.";
    if (!(err instanceof AgentError)) console.error("[agent] run failed", err);
    else if (err.diagnostic) console.error("[agent]", userMessage, err.diagnostic.slice(0, 500));
    if (cancelled && !text) text = "(stopped)";
    await flushText(true);
    await patchMeta(run.messageId, (m) => ({ ...m, status: cancelled ? "done" : "error", error: cancelled ? undefined : userMessage }));
    await getDb().run("UPDATE agent_runs SET state = ?, error = ?, updated_at = ? WHERE id = ?", [cancelled ? "cancelled" : "failed", userMessage, now(), run.id]);
  } finally {
    cancel.stop();
  }
}

export function parseMessageMeta(raw: string | null | undefined): MessageMeta {
  return parseJson<MessageMeta>(raw, {});
}
