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
export async function GET() {
  await dynamic();
  const cfg = getConfig();
  const usage = getDb()
    .prepare(
      `SELECT COUNT(*) AS jobs, COALESCE(SUM(succeeded), 0) AS succeeded, COALESCE(SUM(render_ms), 0) AS render_ms,
        COALESCE(SUM(input_bytes), 0) AS input_bytes, COALESCE(SUM(output_bytes), 0) AS output_bytes,
        COALESCE(SUM(output_seconds), 0) AS output_seconds
       FROM usage_records`,
    )
    .get() as Record<string, number>;
  const planner = getPlanner();
  return Response.json({
    worker: { alive: isWorkerAlive() },
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
    storage: { usedBytes: storageBytesUsed(), freeBytes: await freeDiskBytes() },
  });
}
