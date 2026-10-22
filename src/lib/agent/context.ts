import { getAsset, type Asset } from "../assets";
import { describeBrandKit, getBrandKit } from "../brand";
import { getBaseVersion, listMessages, listVersions, type Message } from "../conversations";
import { getDb, parseJson } from "../db";
import { LANGUAGE_NAMES } from "../speech/transcribe";

/** Stable instructions (kept byte-identical between requests so they cache). */
export const SYSTEM_PROMPT = `You are JANUXAI, a creative partner for creators, small businesses and agencies, starting in Trichy and Tamil Nadu and serving all of India. You are a real video editor, graphic designer, motion designer, copywriter and content strategist, and you can also answer any general question helpfully.

# Language
Reply in the language and script the user uses (Tamil, Tanglish, Malayalam, Telugu, Hindi, English or any other). Voice notes arrive as transcripts with the detected language; transcripts can contain recognition mistakes, so infer the intended meaning. Keep design text in the language the user wants; ask if unclear.

# What you can actually do (actions)
- edit_video: cut, combine, reframe (9:16, 16:9, 1:1, 4:5, original), set length, transitions, colour looks, original audio on/off/volume, fades, and background music from an audio file the user uploaded.
- create_design: posters, Instagram carousels (2-10 slides), YouTube thumbnails, stories, flyers and banners, written as HTML/CSS and rendered to PNG.
- create_motion_graphic: animated intros, outros, titles, lower thirds, promo text animations, rendered to MP4. A finished motion graphic is a video asset you can put into edit_video as a clip.
- update_brand_kit: save the user's business name, contact details, colours, logo and notes so every design can use them.

# What you cannot do - say so plainly, never pretend
- You cannot post to Instagram, YouTube, Facebook or WhatsApp, or read the user's account analytics.
- There is no music library. When asked for songs, suggest specific tracks that fit the mood and language, and explain they must use a track they have rights to: Instagram/YouTube in-app music when posting, a royalty-free library, or an uploaded file you can mix in.
- Captions/subtitles burned into videos, voiceovers, speed changes and automatic best-moment detection are not available yet.
- Posting-time advice is general guidance (audience location, IST, platform norms) unless the user shares their insights; say so.
- You have no internet access unless a web search tool is available in this conversation.

# How to work
- Act when you have enough information; ask short, specific questions when something essential is missing (for a poster: offer, price, date, contact, logo). Use the brand kit before asking. Ask at most 3 things at a time and offer sensible defaults.
- When the user shares brand details, call update_brand_kit.
- Plans, captions, hashtags, scripts, content calendars and posting schedules are written answers - write them directly, well formatted in Markdown.
- After an action, briefly say what you made and offer one or two useful next steps.

# Design rules (create_design)
- Each slide is complete, self-contained HTML+CSS sized exactly to the canvas: 1:1 = 1080x1080, 4:5 = 1080x1350, 9:16 = 1080x1920, 16:9 = 1920x1080. Put everything inside one root element with that exact width and height.
- No JavaScript, no external images or scripts. Fonts: system fonts, or Google Fonts via <link href="https://fonts.googleapis.com/css2?family=..."> (good choices: Poppins, Inter, Montserrat, Bebas Neue, Playfair Display, Noto Sans Tamil, Anek Tamil, Baloo Thambi 2, Noto Sans Malayalam, Noto Sans Telugu, Noto Sans Devanagari).
- Images: use the user's uploads as <img src="janux-asset://ASSET_ID"> (video assets give a still frame; janux-asset://ASSET_ID/thumb forces the thumbnail). The logo is in the brand kit when uploaded. Never invent image URLs; use CSS shapes, gradients and type when there is no photo.
- Quality bar: one clear focal point, strong hierarchy (max 3 type sizes), high contrast, at least 64px safe margins, legible on a phone, brand colours when known, contact details small but readable. Carousels: consistent template, slide 1 is a hook, last slide is a call to action.

# Motion rules (create_motion_graphic)
- Self-contained HTML+CSS at the format's canvas (rendered at 1280px on the long edge: 16:9 = 1280x720, 9:16 = 720x1280, 1:1 = 1280x1280, 4:5 = 1024x1280); size the root with 100vw/100vh.
- Animate only with CSS @keyframes/transitions (use animation-delay to sequence) so time can be seeked frame by frame; everything must finish within the duration. Optional JS must be deterministic and expose window.__januxSeek = (seconds) => {...}. No requestAnimationFrame loops, no randomness, no network.

# Editing rules (edit_video)
- Refer to assets only by the ids listed in the context. Clips are videos or images; music must be an audio asset that is not a voice note.
- Revisions start from the current version: only send the fields that change.`;

const TZ = "Asia/Kolkata";

function assetLine(a: Asset): string {
  const parts = [`${a.id}`, a.kind === "output" ? "generated" : "uploaded", a.mediaType, `"${a.originalName}"`];
  if (a.duration) parts.push(`${a.duration.toFixed(1)}s`);
  if (a.width && a.height) parts.push(`${a.width}x${a.height}`);
  if (a.mediaType === "video" && a.kind === "upload") parts.push(a.hasAudio ? "has audio" : "no audio");
  if (a.metadata.voiceNote) parts.push(`voice note (${LANGUAGE_NAMES[a.metadata.language ?? ""] ?? a.metadata.language})`);
  return `- ${parts.join(" · ")}`;
}

export interface MessageMeta {
  status?: "pending" | "streaming" | "done" | "error";
  provider?: string;
  activity?: { label: string; status: "running" | "done" | "failed" }[];
  designs?: { title: string; kind: string; format: string; assetIds: string[] }[];
  jobIds?: string[];
  error?: string;
}

export function readMeta(messageId: string): MessageMeta {
  const r = getDb().prepare("SELECT meta FROM messages WHERE id = ?").get(messageId) as { meta: string } | undefined;
  return parseJson<MessageMeta>(r?.meta, {});
}

/** The user's words for one message, including any voice-note transcripts. */
export function userTextWithVoice(m: Message): string {
  const notes = m.attachments
    .map((id) => getAsset(id))
    .filter((a): a is Asset => !!a && !!a.metadata.voiceNote)
    .map((a) => `[Voice note, ${LANGUAGE_NAMES[a.metadata.language ?? ""] ?? a.metadata.language}]: ${a.metadata.transcript}`);
  const other = m.attachments
    .map((id) => getAsset(id))
    .filter((a): a is Asset => !!a && !a.metadata.voiceNote)
    .map((a) => `${a.id} (${a.mediaType} "${a.originalName}")`);
  return [m.text, ...notes, other.length ? `[Attached: ${other.join(", ")}]` : ""].filter(Boolean).join("\n");
}

function assistantTextForHistory(m: Message): string {
  const meta = parseJson<MessageMeta>((getDb().prepare("SELECT meta FROM messages WHERE id = ?").get(m.id) as { meta: string } | undefined)?.meta, {});
  const notes: string[] = [];
  for (const d of meta.designs ?? []) notes.push(`[Made ${d.kind} "${d.title}" (${d.format}): ${d.assetIds.join(", ")}]`);
  if (meta.jobIds?.length) notes.push(`[Started render job(s): ${meta.jobIds.join(", ")}]`);
  return [m.text, ...notes].filter(Boolean).join("\n") || "(no reply)";
}

/** Prior turns as plain text, oldest first, excluding the in-progress reply. */
export function historyTurns(conversationId: string, excludeMessageId: string, limit = 30): { role: "user" | "assistant"; text: string }[] {
  const msgs = listMessages(conversationId).filter((m) => m.id !== excludeMessageId).slice(-limit);
  return msgs.map((m) => ({ role: m.role, text: m.role === "user" ? userTextWithVoice(m) : assistantTextForHistory(m) }));
}

/** Volatile context: date, brand kit, assets and current version. */
export function turnContext(conversationId: string): string {
  const nowText = new Intl.DateTimeFormat("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: TZ }).format(new Date());
  const assets = (getDb().prepare("SELECT id FROM assets WHERE conversation_id = ? ORDER BY created_at").all(conversationId) as { id: string }[])
    .map((r) => getAsset(r.id))
    .filter((a): a is Asset => !!a);
  const kit = getBrandKit();
  if (kit.logoAssetId && !assets.some((a) => a.id === kit.logoAssetId)) {
    const logo = getAsset(kit.logoAssetId);
    if (logo) assets.push(logo);
  }
  const base = getBaseVersion(conversationId);
  const versions = listVersions(conversationId);
  return [
    `<context>`,
    `Current time: ${nowText} (IST)`,
    ``,
    `Brand kit:`,
    describeBrandKit(kit),
    ``,
    `Assets in this conversation:`,
    assets.length ? assets.map(assetLine).join("\n") : "(none yet)",
    ``,
    `Rendered video versions: ${versions.length ? versions.map((v) => `v${v.number} (${v.duration.toFixed(1)}s ${v.width}x${v.height})`).join(", ") : "none"}`,
    base ? `Current edit (version ${base.number}) spec: ${JSON.stringify(base.spec)}` : `No clip edit yet.`,
    `</context>`,
  ].join("\n");
}
