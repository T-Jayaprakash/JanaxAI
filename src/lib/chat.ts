import { attachAssetsToConversation, getAssets } from "./assets";
import { getConfig } from "./config";
import {
  addMessage,
  DEFAULT_TITLE,
  getBaseVersion,
  getConversation,
  listVersions,
  renameConversation,
  type Message,
} from "./conversations";
import { createJob, toPublicJob, type PublicJob } from "./jobs";
import { getPlanner } from "./planner";
import { buildTimeline, type TimelineAsset } from "./timeline";
import { queueAgentRun } from "./agent/run";
import { selectBackend } from "./agent/provider";

export class ChatError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function titleFrom(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return DEFAULT_TITLE;
  return clean.length > 48 ? `${clean.slice(0, 45).trimEnd()}…` : clean;
}

/**
 * Handles one user turn: store the message, plan, and either reply directly
 * or queue a render job. Rendering happens in the worker process, so this
 * returns quickly and the job keeps running if the browser closes.
 */
export async function handleUserMessage(conversationId: string, text: string, attachmentIds: string[], workspaceId = "local"): Promise<{
  messages: Message[];
  job: PublicJob | null;
}> {
  const cfg = getConfig();
  const conv = await getConversation(conversationId);
  if (!conv || conv.workspaceId !== workspaceId) throw new ChatError(404, "Conversation not found.");
  const trimmed = text.trim().slice(0, 4000);
  if (!trimmed && attachmentIds.length === 0) throw new ChatError(400, "Write a message or attach a file.");
  if (attachmentIds.length > cfg.maxFilesPerMessage) {
    throw new ChatError(400, `You can attach up to ${cfg.maxFilesPerMessage} files per message.`);
  }
  const unique = [...new Set(attachmentIds)];
  const attachments = await getAssets(unique);
  if (attachments.length !== unique.length) throw new ChatError(400, "One of the attachments no longer exists. Please upload it again.");
  for (const a of attachments) {
    if (a.kind !== "upload" || a.workspaceId !== workspaceId || (a.conversationId && a.conversationId !== conversationId)) {
      throw new ChatError(403, "That attachment belongs to a different conversation.");
    }
  }
  await attachAssetsToConversation(unique, conversationId);

  const userMsg = await addMessage({ conversationId, role: "user", text: trimmed, attachments: unique, jobId: null, versionId: null });
  if (conv.title === DEFAULT_TITLE && trimmed) await renameConversation(conversationId, titleFrom(trimmed));

  // With an AI engine available, the worker writes the reply (streamed).
  const backend = selectBackend();
  if (backend) {
    const reply = await addMessage({
      conversationId, role: "assistant", text: "", attachments: [], jobId: null, versionId: null,
      meta: { status: "pending", provider: backend.label },
    });
    await queueAgentRun(conversationId, reply.id, backend.id);
    return { messages: [userMsg, reply], job: null };
  }

  // Keyword planner: voice-note transcripts count as the user's words.
  const voiceText = attachments.filter((a) => a.metadata.voiceNote).map((a) => a.metadata.transcript ?? "");
  const media = attachments.filter((a) => !a.metadata.voiceNote);
  const base = await getBaseVersion(conversationId);
  const versions = await listVersions(conversationId);
  const planner = getPlanner();
  const plan = await planner.plan({
    text: [trimmed, ...voiceText].filter(Boolean).join(" "),
    attachments: media.map((a) => ({ id: a.id, name: a.originalName, mediaType: a.mediaType, duration: a.duration })),
    baseSpec: base?.spec ?? null,
    baseVersion: base ? { id: base.id, number: base.number } : null,
    baseDuration: base?.duration ?? null,
    versions: versions.map((v) => ({ id: v.id, number: v.number })),
  });

  if (plan.kind === "reply") {
    const reply = await addMessage({
      conversationId, role: "assistant", text: plan.text, attachments: [], jobId: null, versionId: plan.showVersionId ?? null,
    });
    return { messages: [userMsg, reply], job: null };
  }

  const clipAssets = (await getAssets(plan.spec.clips.map((c) => c.assetId))).filter((a) => a.mediaType !== "audio");
  if (clipAssets.length !== new Set(plan.spec.clips.map((c) => c.assetId)).size) {
    const reply = await addMessage({
      conversationId, role: "assistant",
      text: "Some clips from the earlier version were deleted, so I can't revise it. Please upload the clips again.",
      attachments: [], jobId: null, versionId: null,
    });
    return { messages: [userMsg, reply], job: null };
  }
  const assetMap = new Map<string, TimelineAsset>(
    clipAssets.map((a) => [a.id, { id: a.id, name: a.originalName, mediaType: a.mediaType as "video" | "image", duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio }]),
  );
  const timeline = buildTimeline(plan.spec, assetMap, cfg);
  const job = await createJob({
    conversationId,
    parentVersionId: plan.fresh ? null : (base?.id ?? null),
    spec: plan.spec,
    planInfo: { planner: planner.label, usesAI: planner.usesAI, changes: plan.changes, unsupported: plan.unsupported, notes: timeline.notes },
    timeline,
  });
  const reply = await addMessage({ conversationId, role: "assistant", text: plan.summary, attachments: [], jobId: job.id, versionId: null });
  return { messages: [userMsg, reply], job: toPublicJob(job) };
}
