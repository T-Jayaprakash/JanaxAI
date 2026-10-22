# AI providers

JANUXAI doesn't call any AI service today. Every edit is planned by the deterministic rule planner in `src/lib/planner/rules.ts`, and the UI labels it that way.

## The planner interface

`src/lib/planner/types.ts` defines `EditPlanner`. A planner receives:

- the message text
- the assets attached to that message
- the base version's spec and rendered duration
- the list of versions

It returns one of two results:

- `{ kind: "render", spec, fresh, summary, changes, unsupported }`
- `{ kind: "reply", text, showVersionId? }`

Whatever a planner returns, `validateSpec()` (zod) and `buildTimeline()` check it before anything reaches FFmpeg. The renderer only executes explicit numbers and enums, so a model can't inject shell or filter syntax.

## Adding an LLM planner

1. Create `src/lib/planner/llm.ts` that implements `EditPlanner` with `usesAI: true` and a label naming the provider and model.
2. Prompt the model with the supported spec fields (copy them from `EditSpecSchema`) plus the base spec. Ask for JSON only, then parse it with `EditSpecSchema.safeParse`.
3. If the request fails, times out or returns an invalid spec, fall back to `planWithRules()` and add a note to `unsupported` or `changes` saying so.
4. Choose the planner in `getPlanner()` when `JANUX_PLANNER=<id>` and the provider key are set.
5. Record each call in `usage_records.external_ai_calls` and `estimated_cost`.

## Rules

- Keep API keys in server environment variables (`.env.local`, or a secret manager in production). Never use `NEXT_PUBLIC_*` for keys.
- A personal Claude Pro or Max subscription is for your own use of Claude and Claude Code. It isn't an API credential for serving customers. A production integration needs an API account (for example the Claude API with a key from console.anthropic.com), billed per token. Check the provider's current terms, rate limits and pricing before you build on it.
- Send customers' footage, frames or transcripts to an external service only when that integration is configured and your privacy policy says so. Text-only planning (the message plus the spec) is the lowest-risk first step.
- Speech-to-text (for captions), voiceover and translation should each get a separate interface like `EditPlanner`, so providers can be swapped.
