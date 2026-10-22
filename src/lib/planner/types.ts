import type { EditSpec } from "../spec";

export interface PlannerAsset {
  id: string;
  name: string;
  mediaType: "video" | "image" | "audio";
  duration: number | null;
}

export interface PlannerVersion {
  id: string;
  number: number;
}

export interface PlannerInput {
  text: string;
  /** Assets attached to this message, in upload order. */
  attachments: PlannerAsset[];
  /** Spec of the version the user is currently looking at, if any. */
  baseSpec: EditSpec | null;
  baseVersion: PlannerVersion | null;
  /** Rendered duration of the base version (for "make it shorter"). */
  baseDuration: number | null;
  versions: PlannerVersion[];
}

export type PlanResult =
  | {
      kind: "render";
      spec: EditSpec;
      /** true when this starts a new edit rather than revising the base version. */
      fresh: boolean;
      /** Friendly first-person acknowledgement shown in chat. */
      summary: string;
      /** Human-readable list of what changed vs. the base spec. */
      changes: string[];
      /** Requested things that aren't implemented yet. */
      unsupported: string[];
    }
  | { kind: "reply"; text: string; showVersionId?: string };

/**
 * A planner turns a chat message into an explicit editing spec. The default
 * implementation is rule-based. An LLM-backed planner can implement the same
 * interface; its output still goes through validateSpec() before rendering.
 */
export interface EditPlanner {
  id: string;
  /** Shown in the activity card so users know whether an AI model was involved. */
  label: string;
  usesAI: boolean;
  plan(input: PlannerInput): Promise<PlanResult>;
}
