import { requireAccess } from "@/lib/auth/access";
import { getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { dynamic } from "@/lib/http";
import { isWorkerAlive } from "@/lib/jobs";
import { getPlanner } from "@/lib/planner";
import { selectBackend } from "@/lib/agent/provider";
import { chromePath } from "@/lib/graphics/render";
import { isSpeechAvailable } from "@/lib/speech/transcribe";
import { activeVoiceProvider, voiceProviders } from "@/lib/studio/voice";
import { freeDiskBytes, storageBytesUsed } from "@/lib/storage";

/** Real usage numbers for the Account panel — nothing here is estimated. */
export async function GET(req: Request) {
  await dynamic();
  const access = await requireAccess(req);
  if (access instanceof Response) return access;
  const cfg = getConfig();
  const usage = (await getDb().get<Record<string, number>>(
    `SELECT COUNT(*) AS jobs, COALESCE(SUM(u.succeeded), 0) AS succeeded, COALESCE(SUM(u.render_ms), 0) AS render_ms,
      COALESCE(SUM(u.input_bytes), 0) AS input_bytes, COALESCE(SUM(u.output_bytes), 0) AS output_bytes,
      COALESCE(SUM(u.output_seconds), 0) AS output_seconds
     FROM usage_records u JOIN conversations c ON c.id = u.conversation_id WHERE c.workspace_id = ?`,
    [access.workspaceId],
  ))!;
  const planner = getPlanner();
  return Response.json({
    account: { email: access.email, name: access.name, workspaceId: access.workspaceId, workspaceName: access.workspaceName, role: access.role, signedIn: !!access.userId },
    worker: { alive: await isWorkerAlive() },
    planner: { label: planner.label, usesAI: planner.usesAI },
    assistant: (() => {
      const b = selectBackend();
      return b ? { id: b.id, label: b.label, devOnly: b.devOnly } : null;
    })(),
    capabilities: {
      designs: !!chromePath(),
      voiceNotes: isSpeechAvailable(),
      voiceover: (() => {
        const p = voiceProviders().find((x) => x.id === activeVoiceProvider());
        return p ? { label: p.label, premium: p.premium } : null;
      })(),
    },
    limits: {
      maxUploadMB: Math.round(cfg.maxUploadBytes / 1048576),
      maxFilesPerMessage: cfg.maxFilesPerMessage,
      maxClipSeconds: cfg.maxClipSeconds,
      maxOutputSeconds: cfg.maxOutputSeconds,
    },
    usage: {
      renders: usage.jobs,
      succeeded: usage.succeeded,
      failed: usage.jobs - usage.succeeded,
      renderSeconds: Math.round(usage.render_ms / 100) / 10,
      outputSeconds: Math.round(usage.output_seconds * 10) / 10,
      inputBytes: usage.input_bytes,
      outputBytes: usage.output_bytes,
    },
    // Disk numbers describe the server, so only the local single-user studio shows them.
    storage: access.userId ? null : { usedBytes: storageBytesUsed(), freeBytes: await freeDiskBytes() },
  });
}
