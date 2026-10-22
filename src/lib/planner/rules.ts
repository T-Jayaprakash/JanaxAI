import {
  ASPECT_LABELS,
  LOOK_LABELS,
  LOOKS,
  TRANSITION_LABELS,
  validateSpec,
  type Aspect,
  type EditSpec,
  type Look,
} from "../spec";
import type { EditPlanner, PlannerInput, PlanResult } from "./types";

/**
 * Deterministic keyword planner. It understands a fixed vocabulary of edits
 * (English plus a little Tanglish/Tamil) and says plainly when a request is
 * outside that vocabulary. It performs no AI inference.
 */

type Transition = EditSpec["transition"]["type"];

const ORDINALS: Record<string, number> = {
  first: 1, "1st": 1, one: 1, second: 2, "2nd": 2, two: 2, third: 3, "3rd": 3, three: 3,
  fourth: 4, "4th": 4, four: 4, fifth: 5, "5th": 5, five: 5, sixth: 6, "6th": 6, six: 6,
  seventh: 7, "7th": 7, eighth: 8, "8th": 8, ninth: 9, "9th": 9, tenth: 10, "10th": 10,
};

export function normalize(text: string) {
  return text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

export function parseDuration(t: string): number | null {
  if (/half a minute/.test(t)) return 30;
  const min = t.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:min|mins|minute|minutes)\b/);
  if (min) return Number(min[1]) * 60;
  if (/\b(a|one) minute\b/.test(t)) return 60;
  const sec = t.match(/(\d+(?:\.\d+)?)\s*-?\s*(?:s|sec|secs|second|seconds|nodi|நொடி)(?![a-z])/);
  if (sec) return Number(sec[1]);
  return null;
}

export function parseRelativeDuration(t: string): number | null {
  if (/half (the )?(length|duration)|half as long|cut it in half/.test(t)) return 0.5;
  if (/\bshorter\b|make it short\b|cut it down|reduce (the )?(length|duration)|chinna(tha)?\b|short ah\b|korachu|kammi pannu|சின்ன/.test(t)) return 0.7;
  if (/\blonger\b|extend (it|the video)|perusa|periya/.test(t)) return 1.4;
  return null;
}

export function parseAspect(t: string): Aspect | null {
  if (/\b9\s*[:x/]\s*16\b/.test(t)) return "9:16";
  if (/\b4\s*[:x/]\s*5\b/.test(t)) return "4:5";
  if (/\b16\s*[:x/]\s*9\b/.test(t)) return "16:9";
  if (/\b1\s*[:x/]\s*1\b/.test(t)) return "1:1";
  if (/original (size|aspect|shape|ratio|format)/.test(t)) return "original";
  if (/vertical|\breels?\b|\bshorts\b|\bstory\b|\bstories\b|tiktok|status video/.test(t)) return "9:16";
  if (/\bsquare\b/.test(t)) return "1:1";
  if (/landscape|horizontal|widescreen|youtube video/.test(t)) return "16:9";
  return null;
}

export function parseFit(t: string): EditSpec["fit"] | null {
  if (/black bars|letterbox|pillarbox|don't crop|do not crop|no crop/.test(t)) return "pad";
  if (/blur(red)? (background|bars|sides|edges)/.test(t)) return "blur";
  if (/\bcrop\b|fill the (frame|screen)|zoom (in )?to fill|full ?screen/.test(t)) return "crop";
  return null;
}

export function parseTransition(t: string): { type: Transition; duration?: number } | null {
  if (/no transitions?|hard cuts?|straight cuts?|remove (the )?transitions?|without transitions?|jump cuts?/.test(t)) {
    return { type: "none" };
  }
  const duration = /(slow|longer|gentle) transitions?/.test(t) ? 1 : /(quick|fast|short(er)?) transitions?/.test(t) ? 0.3 : undefined;
  if (/\bwipes?\b/.test(t)) return { type: "wipeleft", duration };
  if (/\bslides?\b/.test(t)) return { type: "slideleft", duration };
  if (/circle/.test(t)) return { type: "circleopen", duration };
  if (/dissolve/.test(t)) return { type: "dissolve", duration };
  if (/cross ?fades?|smooth transitions?|\btransitions?\b|fade between/.test(t)) return { type: "fade", duration };
  return null;
}

export function parseLook(t: string, current: Look): Look | null {
  if (/black (and|&|n) white|\bb ?& ?w\b|monochrome|gr[ae]yscale/.test(t)) return "bw";
  if (/natural colou?rs|no filter|remove (the )?(filter|colou?r grade|grade|look)|original colou?rs/.test(t)) return "none";
  if (/cinematic|film look|movie look|filmic|\bmass\b/.test(t)) return "cinematic";
  if (/vibrant|colou?rful|punchy|saturated|bright colou?rs/.test(t)) return "vibrant";
  if (/\bwarm(er)?\b|golden/.test(t)) return "warm";
  if (/\bcool(er)? (tone|look|colou?rs)|\bcold\b|blue tone|teal/.test(t)) return "cool";
  if (/different (style|look)|another (style|look|version)|new style|try something else|other style/.test(t)) {
    const cycle = LOOKS.filter((l) => l !== "none");
    const i = cycle.indexOf(current as (typeof cycle)[number]);
    return cycle[(i + 1) % cycle.length];
  }
  return null;
}

export function parseAudio(t: string): { keepOriginal?: boolean; volumeFactor?: number } {
  const out: { keepOriginal?: boolean; volumeFactor?: number } = {};
  if (/\bunmute\b|keep (the )?(original )?(sound|audio)|bring back (the )?(sound|audio)|restore (the )?(sound|audio)/.test(t)) {
    out.keepOriginal = true;
  } else if (
    /\bmute\b|no (sound|audio)|remove (the )?(original )?(sound|audio)|without (sound|audio)|\bsilent\b|(sound|audio|satham) ven(d)?a+m|sound illama|ஒலி வேண்டாம்|சத்தம் வேண்டாம்/.test(t)
  ) {
    out.keepOriginal = false;
  }
  if (/louder|increase (the )?volume|volume up|boost (the )?(audio|sound|volume)|sound (jaasthi|jasthi|adhigam)/.test(t)) out.volumeFactor = 1.5;
  else if (/quieter|lower (the )?volume|reduce (the )?volume|volume down|softer audio|sound (kammi|korai)/.test(t)) out.volumeFactor = 0.6;
  return out;
}

export function parseFade(t: string): boolean | null {
  if (/no fades?|remove (the )?fades?|without fades?/.test(t)) return false;
  if (/fade[ -](in|out)/.test(t)) return true;
  return null;
}

/** Returns a 0-based clip index to remove, or -1 for "last". */
export function parseRemoveClip(t: string): number | null {
  const m =
    t.match(/(?:remove|delete|drop|skip|cut out|take out)\s+(?:the\s+)?(\w+)\s+(?:clip|video|shot|part)/) ??
    t.match(/(?:remove|delete|drop|skip|cut out|take out)\s+(?:clip|video|shot)\s*(?:number\s*|#)?(\d+)/);
  if (!m) return null;
  const word = m[1];
  if (word === "last" || word === "final") return -1;
  const n = ORDINALS[word] ?? (/^\d+$/.test(word) ? Number(word) : NaN);
  return Number.isFinite(n) && n > 0 ? n - 1 : null;
}

export function detectUnsupported(t: string): string[] {
  const out: string[] = [];
  if (/caption|subtitle|\bsubs\b|transcri/.test(t)) out.push("Captions and subtitles need a speech-to-text provider, which isn't configured yet.");
  if (/music|\bsong\b|\bbgm\b|soundtrack/.test(t)) out.push("Background music isn't available yet — there's no music library configured.");
  if (/voice ?over|narrat|\bdub|translat/.test(t)) out.push("Voiceover, dubbing and translation aren't available yet.");
  if (/\btext\b|\btitles?\b|overlay|\blogo\b|watermark|sticker|emoji/.test(t)) out.push("Text, title and logo overlays aren't available yet.");
  if (/slow ?mo|slow motion|speed (it )?up|\bfaster\b|timelapse|\d(\.\d)?x speed/.test(t)) out.push("Speed changes aren't available yet.");
  if (/boring|best (parts|moments|shots|bits)|highlights?|remove (the )?(silence|pauses)/.test(t)) {
    out.push("Automatic best-moment detection isn't available yet, so I use the middle part of each clip.");
  }
  if (/\bopening\b|\bhook\b|\bintro\b|first (three|3) seconds/.test(t)) out.push("Reworking the opening needs scene analysis, which isn't available yet.");
  return out;
}

const HELP =
  "Here's what I can change right now: length (\"make it 15 seconds\", \"shorter\"), shape (\"vertical\", \"16:9\", \"square\"), " +
  "framing (\"crop to fill\", \"blurred background\", \"black bars\"), transitions (\"crossfade\", \"wipe\", \"no transitions\"), " +
  "look (\"cinematic\", \"black and white\", \"vibrant\", \"warm\"), audio (\"mute\", \"louder\"), fades, removing or reordering clips, " +
  "and showing earlier versions.";

function fmtSec(n: number) {
  return `${Math.round(n * 10) / 10}s`;
}

function parseVersionNav(t: string, input: PlannerInput): PlanResult | null {
  const wantsNav = /\b(show|see|play|open|go back to|revert to|switch to|bring back|back to|watch)\b/.test(t) || /^undo\b/.test(t);
  if (!wantsNav) return null;
  const numbered = t.match(/version\s*#?\s*(\d+)/);
  if (numbered) {
    const v = input.versions.find((x) => x.number === Number(numbered[1]));
    if (!v) return { kind: "reply", text: `There's no version ${numbered[1]} in this conversation yet.` };
    return { kind: "reply", text: `Here's version ${v.number}. Any changes you ask for next will start from this version.`, showVersionId: v.id };
  }
  const prev = /(previous|last|earlier|older|before) (version|one|video|edit)|^undo\b/.test(t);
  const original = /(first|original) (version|one|video|edit)/.test(t);
  if (!prev && !original) return null;
  if (!input.versions.length) return { kind: "reply", text: "There aren't any rendered versions yet." };
  const sorted = [...input.versions].sort((a, b) => a.number - b.number);
  if (original) {
    const v = sorted[0];
    return { kind: "reply", text: `Here's version ${v.number}, the first one. Changes you ask for next will start from it.`, showVersionId: v.id };
  }
  const baseNum = input.baseVersion?.number ?? sorted[sorted.length - 1].number;
  const before = sorted.filter((v) => v.number < baseNum).pop();
  if (!before) return { kind: "reply", text: `Version ${baseNum} is the earliest version — there's nothing before it.` };
  return { kind: "reply", text: `Here's version ${before.number}. Changes you ask for next will start from this version.`, showVersionId: before.id };
}

function defaultSpec(assetIds: string[]): EditSpec {
  return {
    version: 1,
    clips: assetIds.map((assetId) => ({ assetId, in: null, out: null })),
    aspect: "original",
    fit: "blur",
    targetDuration: null,
    transition: { type: assetIds.length > 1 ? "fade" : "none", duration: 0.5 },
    look: "none",
    audio: { keepOriginal: true, volume: 1 },
    fadeInOut: false,
  };
}

export function planWithRules(input: PlannerInput): PlanResult {
  const t = normalize(input.text);
  const nav = parseVersionNav(t, input);
  if (nav) return nav;

  const base = input.baseSpec;
  const attachments = input.attachments;
  if (!base && attachments.length === 0) {
    if (!t || /^(hi|hey|hello|vanakkam|hai)\b/.test(t)) {
      return { kind: "reply", text: "Vanakkam! Attach your clips with the paperclip button and tell me what kind of video you want — for example, \"Combine these into a 15-second vertical reel.\"" };
    }
    return {
      kind: "reply",
      text: "I'll need some footage first. Attach one or more video clips or photos with the paperclip button, then describe the video you want.",
    };
  }

  const appendMode = !!base && attachments.length > 0 && /\b(add|append|include|also use|insert|attach)\b/.test(t);
  const fresh = !base || (attachments.length > 0 && !appendMode);
  const spec: EditSpec = fresh ? defaultSpec(attachments.map((a) => a.id)) : structuredClone(base!);
  const changes: string[] = [];

  if (appendMode) {
    for (const a of attachments) spec.clips.push({ assetId: a.id, in: null, out: null });
    changes.push(`added ${attachments.length} new clip${attachments.length > 1 ? "s" : ""} at the end`);
    if (spec.clips.length > 1 && spec.transition.type === "none" && base!.clips.length === 1) spec.transition.type = "fade";
  }

  // Clip removal / ordering.
  const removeIdx = parseRemoveClip(t);
  if (removeIdx !== null) {
    const idx = removeIdx === -1 ? spec.clips.length - 1 : removeIdx;
    if (idx >= spec.clips.length) {
      return { kind: "reply", text: `There are only ${spec.clips.length} clip${spec.clips.length > 1 ? "s" : ""} in this edit, so I can't remove clip ${idx + 1}.` };
    }
    if (spec.clips.length === 1) return { kind: "reply", text: "That's the only clip in this edit — I need at least one clip to make a video." };
    spec.clips.splice(idx, 1);
    changes.push(`removed clip ${idx + 1}`);
  }
  if (/reverse (the )?order|backwards order|opposite order/.test(t) && spec.clips.length > 1) {
    spec.clips.reverse();
    changes.push("reversed the clip order");
  } else if (/(last|final) (clip|shot|video) (to the |at the )?(start|beginning|first|front)/.test(t) && spec.clips.length > 1) {
    spec.clips.unshift(spec.clips.pop()!);
    changes.push("moved the last clip to the start");
  }

  const aspect = parseAspect(t);
  if (aspect && aspect !== spec.aspect) {
    spec.aspect = aspect;
    changes.push(`shape → ${ASPECT_LABELS[aspect]}`);
  }
  const fit = parseFit(t);
  if (fit && fit !== spec.fit) {
    spec.fit = fit;
    changes.push(`framing → ${fit === "crop" ? "crop to fill" : fit === "pad" ? "black bars" : "blurred background"}`);
  }

  const abs = parseDuration(t);
  const rel = abs === null ? parseRelativeDuration(t) : null;
  if (abs !== null) {
    const d = Math.min(Math.max(abs, 1), 600);
    if (d !== spec.targetDuration) {
      spec.targetDuration = d;
      changes.push(`length → ${fmtSec(d)}`);
    }
  } else if (rel !== null) {
    const current = input.baseDuration ?? spec.targetDuration;
    if (current) {
      const d = Math.max(2, Math.round(current * rel));
      spec.targetDuration = d;
      changes.push(`length → about ${fmtSec(d)}`);
    }
  }

  const tr = parseTransition(t);
  if (tr) {
    const next = { type: tr.type, duration: tr.duration ?? spec.transition.duration };
    if (next.type !== spec.transition.type || next.duration !== spec.transition.duration) {
      spec.transition = next;
      changes.push(`transitions → ${TRANSITION_LABELS[next.type]}`);
    }
  }

  const look = parseLook(t, spec.look);
  if (look && look !== spec.look) {
    spec.look = look;
    changes.push(`look → ${LOOK_LABELS[look]}`);
    if (look === "cinematic" && fresh) spec.fadeInOut = true;
  }

  const fade = parseFade(t);
  if (fade !== null && fade !== spec.fadeInOut) {
    spec.fadeInOut = fade;
    changes.push(fade ? "added fade in/out" : "removed fade in/out");
  }

  const audio = parseAudio(t);
  if (audio.keepOriginal !== undefined && audio.keepOriginal !== spec.audio.keepOriginal) {
    spec.audio.keepOriginal = audio.keepOriginal;
    changes.push(audio.keepOriginal ? "original audio restored" : "original audio muted");
  }
  if (audio.volumeFactor) {
    spec.audio.volume = Math.min(3, Math.max(0.1, Math.round(spec.audio.volume * audio.volumeFactor * 100) / 100));
    if (!audio.keepOriginal && !spec.audio.keepOriginal && audio.volumeFactor > 1) spec.audio.keepOriginal = true;
    changes.push(audio.volumeFactor > 1 ? "audio louder" : "audio quieter");
  }

  const unsupported = detectUnsupported(t);

  if (!fresh && changes.length === 0) {
    if (unsupported.length) {
      return { kind: "reply", text: `${unsupported.join(" ")}\n\n${HELP}` };
    }
    return { kind: "reply", text: `I couldn't match that to an edit I know how to make yet. ${HELP}` };
  }

  const valid = validateSpec(spec);
  return { kind: "render", spec: valid, fresh, summary: summarize(valid, fresh, changes, unsupported, attachments.length), changes, unsupported };
}

function summarize(spec: EditSpec, fresh: boolean, changes: string[], unsupported: string[], attachedCount: number): string {
  const parts: string[] = [];
  if (fresh) {
    const n = spec.clips.length;
    const what = n > 1 ? `combine your ${n} clips` : attachedCount ? "edit your clip" : "edit your footage";
    const len = spec.targetDuration ? `a ${fmtSec(spec.targetDuration).replace("s", "-second")}` : "a";
    const shape = spec.aspect === "original" ? "" : ` ${ASPECT_LABELS[spec.aspect]}`;
    let s = `Got it. I'll ${what} into ${len}${shape} video`;
    const extras: string[] = [];
    if (n > 1) extras.push(spec.transition.type === "none" ? "hard cuts" : `${TRANSITION_LABELS[spec.transition.type]} transitions`);
    if (spec.look !== "none") extras.push(`a ${LOOK_LABELS[spec.look]}`);
    if (spec.fadeInOut) extras.push("a fade in and out");
    if (!spec.audio.keepOriginal) extras.push("the original audio muted");
    if (extras.length) s += ` with ${extras.join(", ").replace(/, ([^,]*)$/, " and $1")}`;
    parts.push(s + ".");
  } else {
    parts.push(`Sure — making a new version: ${changes.join(", ")}. Everything else stays the same.`);
  }
  if (unsupported.length) parts.push(`Heads up: ${unsupported.join(" ")}`);
  return parts.join("\n\n");
}

export const rulePlanner: EditPlanner = {
  id: "rules-v1",
  label: "Rule-based planner (keyword matching, no AI model)",
  usesAI: false,
  async plan(input) {
    return planWithRules(input);
  },
};
