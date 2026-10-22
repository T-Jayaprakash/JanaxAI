import { rulePlanner } from "./rules";
import type { EditPlanner } from "./types";

export type { EditPlanner, PlannerInput, PlanResult } from "./types";

/**
 * Picks the planner from JANUX_PLANNER. Only "rules" exists today; see
 * docs/AI_PROVIDERS.md for how to add an LLM-backed planner. Unknown values
 * fall back to the rule planner rather than failing requests.
 */
export function getPlanner(): EditPlanner {
  const id = process.env.JANUX_PLANNER || "rules";
  if (id !== "rules") {
    console.warn(`[janux] Planner "${id}" is not implemented; using the rule-based planner.`);
  }
  return rulePlanner;
}
