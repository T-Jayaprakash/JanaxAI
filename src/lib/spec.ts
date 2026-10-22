import { z } from "zod";

/**
 * The editing specification is the contract between the planner (which turns
 * chat into intent) and the renderer (which only executes explicit values).
 * Every job stores one; revisions copy the parent's spec and change fields.
 */
export const ASPECTS = ["9:16", "16:9", "1:1", "4:5", "original"] as const;
export const FITS = ["blur", "crop", "pad"] as const;
export const TRANSITIONS = ["none", "fade", "dissolve", "wipeleft", "slideleft", "circleopen"] as const;
export const LOOKS = ["none", "cinematic", "vibrant", "bw", "warm", "cool"] as const;

export const ClipSchema = z.object({
  assetId: z.string().regex(/^ast_[a-f0-9]{32}$/),
  /** Optional manual trim in source seconds. null = let the timeline decide. */
  in: z.number().min(0).nullable(),
  out: z.number().positive().nullable(),
});

export const EditSpecSchema = z.object({
  version: z.literal(1),
  clips: z.array(ClipSchema).min(1).max(20),
  aspect: z.enum(ASPECTS),
  fit: z.enum(FITS),
  targetDuration: z.number().min(1).max(600).nullable(),
  transition: z.object({
    type: z.enum(TRANSITIONS),
    duration: z.number().min(0.1).max(2),
  }),
  look: z.enum(LOOKS),
  audio: z.object({
    keepOriginal: z.boolean(),
    volume: z.number().min(0).max(3),
  }),
  fadeInOut: z.boolean(),
  /** Background music track (an uploaded audio asset), mixed under the edit. */
  music: z
    .object({
      assetId: z.string().regex(/^ast_[a-f0-9]{32}$/),
      volume: z.number().min(0).max(2),
    })
    .nullable()
    .default(null),
});

export type EditSpec = z.infer<typeof EditSpecSchema>;
export type Aspect = EditSpec["aspect"];
export type Look = EditSpec["look"];

export function validateSpec(spec: unknown): EditSpec {
  return EditSpecSchema.parse(spec);
}

export const LOOK_LABELS: Record<Look, string> = {
  none: "natural colors",
  cinematic: "cinematic grade",
  vibrant: "vibrant colors",
  bw: "black & white",
  warm: "warm tone",
  cool: "cool tone",
};

export const TRANSITION_LABELS: Record<EditSpec["transition"]["type"], string> = {
  none: "hard cuts",
  fade: "crossfade",
  dissolve: "dissolve",
  wipeleft: "wipe",
  slideleft: "slide",
  circleopen: "circle reveal",
};

export const ASPECT_LABELS: Record<Aspect, string> = {
  "9:16": "vertical 9:16",
  "16:9": "landscape 16:9",
  "1:1": "square 1:1",
  "4:5": "portrait 4:5",
  original: "original shape",
};
