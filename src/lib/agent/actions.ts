import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getAsset, getAssets, insertAsset, type Asset } from "../assets";
import { BrandKitSchema, updateBrandKit } from "../brand";
import { getConfig } from "../config";
import { getBaseVersion } from "../conversations";
import { newId, now } from "../db";
import { resolveAssetRefs } from "../graphics/assetRefs";
import { DESIGN_FORMATS, renderHtmlToPng } from "../graphics/render";
import { createJob, createMotionJob, type PlanInfo } from "../jobs";
import { makeThumbnail } from "../media/probe";
import { ASPECTS, FITS, LOOKS, TRANSITIONS, validateSpec, type EditSpec } from "../spec";
import { getStorage } from "../storage";
import { buildTimeline, type TimelineAsset } from "../timeline";

/**
 * The things the assistant can actually do. Both AI backends use these:
 * the Claude API as native tools, the local Claude Code CLI as a JSON block.
 * Every input is validated here before anything runs.
 */

const AssetId = z.string().regex(/^ast_[a-f0-9]{32}$/);
const Format = z.enum(["1:1", "4:5", "9:16", "16:9"]);

export const EditVideoInput = z.object({
  clips: z.array(AssetId).min(1).max(20).optional().describe("Video/image asset ids in playback order. Omit to keep the current version's clips."),
  aspect: z.enum(ASPECTS).optional(),
  fit: z.enum(FITS).optional().describe("blur = blurred background, crop = fill frame, pad = black bars"),
  targetDuration: z.number().min(1).max(600).nullable().optional().describe("Seconds; null = use all footage"),
  transition: z.object({ type: z.enum(TRANSITIONS), duration: z.number().min(0.1).max(2).optional() }).optional(),
  look: z.enum(LOOKS).optional(),
  keepOriginalAudio: z.boolean().optional(),
  audioVolume: z.number().min(0).max(3).optional(),
  fadeInOut: z.boolean().optional(),
  musicAssetId: AssetId.nullable().optional().describe("An uploaded audio asset to mix as background music; null removes music"),
  musicVolume: z.number().min(0).max(2).optional(),
});

export const DesignInput = z.object({
  kind: z.enum(["poster", "carousel", "thumbnail", "story", "flyer", "banner"]),
  format: Format,
  title: z.string().min(1).max(80),
  slides: z
    .array(z.object({ html: z.string().min(20).max(60_000).describe("Complete self-contained HTML+CSS for one slide at the exact canvas size") }))
    .min(1)
    .max(10),
});

export const MotionInput = z.object({
  title: z.string().min(1).max(80),
  format: Format,
  duration: z.number().min(1).max(20),
  html: z.string().min(20).max(80_000).describe("Self-contained HTML+CSS using @keyframes animations that complete within the duration"),
});

export const BrandInput = BrandKitSchema.partial();

export const ACTIONS = {
  edit_video: {
    schema: EditVideoInput,
    description:
      "Render a video from the user's clips (new edit or a revision of the current version). Only set fields you want to change; everything else carries over from the current version.",
  },
  create_design: {
    schema: DesignInput,
    description:
      "Render a poster, carousel (2-10 slides), thumbnail, story, flyer or banner from HTML/CSS you write. Each slide becomes a PNG at the format's exact size.",
  },
  create_motion_graphic: {
    schema: MotionInput,
    description: "Render an animated title, intro/outro, lower third, promo or text animation from HTML/CSS keyframes to an MP4 (silent).",
  },
  update_brand_kit: {
    schema: BrandInput,
    description: "Save brand details the user gives you (business name, tagline, phone, WhatsApp, email, website, Instagram, address, colors, logo asset id, notes).",
  },
} as const;
export type ActionName = keyof typeof ACTIONS;

export interface DesignResult {
  title: string;
  kind: string;
  format: string;
  assetIds: string[];
}

export interface ActionContext {
  conversationId: string;
  planner: { label: string; usesAI: boolean };
}

export interface ActionOutcome {
  ok: boolean;
  /** Short text returned to the model. */
  summary: string;
  jobId?: string;
  design?: DesignResult;
  /** Rendered PNG paths, so the API backend can show Claude its own work. */
  previewPaths?: string[];
}

export function actionJsonSchemas() {
  return (Object.keys(ACTIONS) as ActionName[]).map((name) => {
    const schema = z.toJSONSchema(ACTIONS[name].schema, { target: "draft-7" }) as Record<string, unknown>;
    delete schema.$schema;
    return { name, description: ACTIONS[name].description, input_schema: schema };
  });
}

export async function executeAction(name: string, input: unknown, ctx: ActionContext): Promise<ActionOutcome> {
  if (!(name in ACTIONS)) return { ok: false, summary: `Unknown action "${name}".` };
  const parsed = ACTIONS[name as ActionName].schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, summary: `Invalid input for ${name}: ${z.prettifyError(parsed.error).slice(0, 1500)}` };
  }
  try {
    switch (name as ActionName) {
      case "edit_video":
        return editVideo(parsed.data as z.infer<typeof EditVideoInput>, ctx);
      case "create_design":
        return await createDesign(parsed.data as z.infer<typeof DesignInput>, ctx);
      case "create_motion_graphic":
        return createMotion(parsed.data as z.infer<typeof MotionInput>, ctx);
      case "update_brand_kit": {
        const kit = updateBrandKit(parsed.data as z.infer<typeof BrandInput>);
        return { ok: true, summary: `Brand kit saved: ${Object.keys(parsed.data).join(", ")}. Business name is now "${kit.businessName || "(not set)"}".` };
      }
    }
  } catch (err) {
    return { ok: false, summary: err instanceof Error ? err.message : String(err) };
  }
}

function ownedAsset(id: string, conversationId: string): Asset | null {
  const a = getAsset(id);
  return a && (a.conversationId === conversationId || a.conversationId === null) ? a : null;
}

function editVideo(input: z.infer<typeof EditVideoInput>, ctx: ActionContext): ActionOutcome {
  const base = getBaseVersion(ctx.conversationId);
  if (!input.clips && !base) return { ok: false, summary: "No clips given and there is no earlier version to revise. Pass clip asset ids." };
  const clipIds = input.clips ?? base!.spec.clips.map((c) => c.assetId);
  for (const id of clipIds) {
    const a = ownedAsset(id, ctx.conversationId);
    if (!a || a.mediaType === "audio") return { ok: false, summary: `Asset ${id} isn't a video or image in this conversation.` };
  }
  if (input.musicAssetId) {
    const m = ownedAsset(input.musicAssetId, ctx.conversationId);
    if (!m || m.mediaType !== "audio" || m.metadata.voiceNote) return { ok: false, summary: `Asset ${input.musicAssetId} isn't a music file in this conversation.` };
  }
  const prev: Partial<EditSpec> = base && !input.clips ? base.spec : base?.spec ?? {};
  const keepClipTrims = !input.clips && base;
  const spec = validateSpec({
    version: 1,
    clips: keepClipTrims ? base!.spec.clips : clipIds.map((assetId) => ({ assetId, in: null, out: null })),
    aspect: input.aspect ?? prev.aspect ?? "original",
    fit: input.fit ?? prev.fit ?? "blur",
    targetDuration: input.targetDuration !== undefined ? input.targetDuration : (prev.targetDuration ?? null),
    transition: {
      type: input.transition?.type ?? prev.transition?.type ?? (clipIds.length > 1 ? "fade" : "none"),
      duration: input.transition?.duration ?? prev.transition?.duration ?? 0.5,
    },
    look: input.look ?? prev.look ?? "none",
    audio: {
      keepOriginal: input.keepOriginalAudio ?? prev.audio?.keepOriginal ?? true,
      volume: input.audioVolume ?? prev.audio?.volume ?? 1,
    },
    fadeInOut: input.fadeInOut ?? prev.fadeInOut ?? false,
    music:
      input.musicAssetId === null
        ? null
        : input.musicAssetId
          ? { assetId: input.musicAssetId, volume: input.musicVolume ?? prev.music?.volume ?? 0.8 }
          : prev.music
            ? { ...prev.music, volume: input.musicVolume ?? prev.music.volume }
            : null,
  });
  const clipAssets = getAssets(spec.clips.map((c) => c.assetId));
  const map = new Map<string, TimelineAsset>(
    clipAssets.map((a) => [a.id, { id: a.id, name: a.originalName, mediaType: a.mediaType as "video" | "image", duration: a.duration, width: a.width, height: a.height, hasAudio: a.hasAudio }]),
  );
  const timeline = buildTimeline(spec, map, getConfig());
  const planInfo: PlanInfo = { planner: ctx.planner.label, usesAI: ctx.planner.usesAI, changes: [], unsupported: [], notes: timeline.notes };
  const job = createJob({ conversationId: ctx.conversationId, parentVersionId: input.clips ? null : (base?.id ?? null), spec, planInfo, timeline });
  return {
    ok: true,
    jobId: job.id,
    summary: `Render job queued: ${timeline.segments.length} clip(s), ${timeline.width}x${timeline.height}, ~${timeline.totalDuration.toFixed(1)}s. ${timeline.notes.join(" ")} The user will see live progress and the video when it's ready.`,
  };
}

async function createDesign(input: z.infer<typeof DesignInput>, ctx: ActionContext): Promise<ActionOutcome> {
  const { width, height } = DESIGN_FORMATS[input.format];
  const storage = getStorage();
  storage.ensureDir("outputs");
  storage.ensureDir("thumbs");
  const assetIds: string[] = [];
  const previewPaths: string[] = [];
  for (const [i, slide] of input.slides.entries()) {
    const id = newId("ast");
    const key = `outputs/${id}.png`;
    const file = storage.absolutePath(key);
    await renderHtmlToPng(resolveAssetRefs(slide.html), width, height, file);
    const thumbKey = `thumbs/${id}.jpg`;
    await makeThumbnail(file, storage.absolutePath(thumbKey), null);
    const safeTitle = input.title.replace(/[^A-Za-z0-9 _-]/g, "").trim().slice(0, 40) || input.kind;
    insertAsset({
      id,
      conversationId: ctx.conversationId,
      kind: "output",
      mediaType: "image",
      originalName: input.slides.length > 1 ? `${safeTitle}-${i + 1}.png` : `${safeTitle}.png`,
      storageKey: key,
      thumbKey,
      mime: "image/png",
      size: fs.statSync(file).size,
      duration: null,
      width,
      height,
      hasAudio: false,
      metadata: {},
      createdAt: now(),
    });
    assetIds.push(id);
    previewPaths.push(storage.absolutePath(thumbKey));
  }
  return {
    ok: true,
    design: { title: input.title, kind: input.kind, format: input.format, assetIds },
    previewPaths,
    summary: `Rendered ${assetIds.length} ${input.kind} image(s) at ${width}x${height}: ${assetIds.join(", ")}. They are shown to the user with download buttons.`,
  };
}

function createMotion(input: z.infer<typeof MotionInput>, ctx: ActionContext): ActionOutcome {
  const job = createMotionJob({
    conversationId: ctx.conversationId,
    motion: { title: input.title, format: input.format, duration: input.duration, fps: 30, html: input.html },
    planInfo: { planner: ctx.planner.label, usesAI: ctx.planner.usesAI, changes: [], unsupported: [], notes: [] },
  });
  return {
    ok: true,
    jobId: job.id,
    summary: `Motion graphic render queued (${input.duration}s, ${input.format}). When it finishes it becomes a video asset that can also be used as a clip in edit_video.`,
  };
}

/** Used by the API backend to attach rendered previews to tool results. */
export function previewBase64(p: string): string {
  return fs.readFileSync(path.resolve(p)).toString("base64");
}
