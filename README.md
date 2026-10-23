# JANUXAI

**Just tell it. It'll make the video.**

JANUXAI is a conversational creative assistant for creators and small businesses. You can chat with it like Claude, and it can:

- edit your clips into reels and ads
- design posters, carousels and thumbnails
- make animated intros and titles
- plan content, captions, hashtags and posting times
- understand voice notes in Tamil, Malayalam, Telugu, Hindi, English and other languages

This is a private local prototype. Videos, designs and voice transcription all run on your own computer.

## Quick start

Requirements:

- Node.js 20 or newer (tested on 22) and npm
- FFmpeg with `ffprobe` on your `PATH` (`brew install ffmpeg`)
- Google Chrome, which renders designs and motion graphics
- An AI engine: either Claude Code installed and signed in (`claude`), for local testing with your own Claude plan, or `ANTHROPIC_API_KEY` for production. See [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md).

```bash
npm install
npm run setup:speech   # optional: local voice-note transcription (whisper.cpp + ~466 MB model)
npm run setup:library  # fonts, animated emoji, colour looks, sound effects (~35 MB)
npm run setup:tracking # optional, macOS: Apple Vision subject tracker for reframing (compiles in seconds)
npm run dev
```

Open http://127.0.0.1:3000. `npm run dev` starts two processes:

| Process | What it does |
| --- | --- |
| `web` | Next.js app: chat UI and API routes |
| `worker` | Render worker: claims queued jobs from SQLite and runs FFmpeg |

You can run them separately with `npm run web` and `npm run worker`. If the worker isn't running, jobs wait in the queue and the chat shows a banner saying so.

Other commands:

```bash
npm test          # planner, timeline and real FFmpeg pipeline tests (~10s)
npm run typecheck
npm run lint
npm run build && npm start   # production mode, still local
```

## Things to try

- "What are the best times to post reels for my Trichy bakery this week? Suggest 3 Tamil songs for a Diwali sweets reel."
- "Here's my raw vlog. Cut the boring parts and mistakes, add mass captions with emojis, and sync it to this song."
- "Edit my clips in the same style as this reference" (attach a reference image or video).
- "Make a 4-second animated intro with our name", then "Put that intro at the start of my reel."
- Record a voice note in Tamil: "இந்த வீடியோவை செங்குத்தாக மாற்றி 15 வினாடிகளாக குறைக்கவும்."
- Attach an MP3 you have the rights to and say "use this as background music, keep it soft."
- "Plan my Instagram content for next week with captions and hashtags."

## The video MVP journey

1. Open JANUXAI and attach two or more clips (paperclip button, drag and drop, or paste).
2. Type "Combine these clips into a 15-second vertical reel" and press Enter.
3. A job card appears and shows each real pipeline step with live FFmpeg progress.
4. Open the **Timeline** tab to see which part of each clip is used, or **Edit spec** for the exact JSON spec.
5. When the output passes validation, the video appears inline. You can play it, download it, or tap a revision chip.
6. Ask for a change ("make it 8 seconds and 16:9"). This creates version 2 from version 1's spec, and earlier versions are kept.
7. Refresh the page. The conversation, jobs and versions come back from SQLite, and a job that's still running keeps streaming.

## What works today

With an AI engine, JANUXAI works as a **video studio**: you ask for any video in your own words or language, and Claude edits it like a human editor would. It watches the footage as frames, listens to the speech with word timings, finds the beat of your song, and cuts with FFmpeg. It builds captions, emojis, titles and motion graphics as HTML animations, checks frames of its own render, and delivers an MP4. See [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md#the-studio-toolkit).

**Professional asset library** ([docs/ASSET_LIBRARY.md](docs/ASSET_LIBRARY.md)), searchable by the editor and browsable in the studio's Library panel:

- 82 font families, including Tamil and other Indian scripts
- 58 xfade + 14 overlay transitions
- 20 caption styles, with Tamil kept whole
- 19 animated stickers and 59 animated emoji
- 30 sound effects
- 10 colour looks
- 12 meme formats

Licences are tracked, and required credits are added to deliveries automatically.

Verified live with the local Claude engine:

- **Raw creator footage to reel.** 26 seconds of raw talking with pauses, an "um" and a restarted take became a 14.2s 1080×1920 reel. Every mistake was cut, it has word-by-word gold captions with emojis, music is synced to the beat and ducked under the voice, and loudness is −14.1 LUFS.
- **Tanglish revision.** "9 seconds-ku kurachidu, second clip venam, warm look, fade podu" applied all four changes.
- **Motion graphics.** A 4-second animated brand intro, rendered frame by frame.

Without an AI engine, the keyword planner still handles video edits. It understands these requests:

| Area | Examples |
| --- | --- |
| Length | "15-second", "make it 30 seconds", "shorter", "half the length", "longer" |
| Shape | "vertical", "reel", "shorts", "9:16", "16:9", "square", "4:5", "original size" |
| Framing | "blurred background" (default), "crop to fill", "black bars" |
| Transitions | "smooth transitions"/"crossfade", "dissolve", "wipe", "slide", "no transitions" |
| Look | "cinematic", "black and white", "vibrant", "warm", "cool", "natural colors", "try a different style" |
| Audio | "mute", "restore audio", "louder", "quieter" |
| Fades | "fade in and out", "no fades" |
| Clips | "remove the second clip", "drop the last clip", "reverse the order", "move the last clip to the start", "add this clip" (with a new attachment) |
| Versions | "show me the previous version", "go back to version 2", "undo" |
| Tanglish/Tamil (a few) | "sound venam", "chinnatha pannu", "vertical ah", "ஒலி வேண்டாம்" |

Requests that aren't supported, such as captions, music, voiceover, text overlays, speed changes or best-moment detection, are named as unavailable in the reply and in the job card. They are never faked.

Other features:

- **Uploads:** MP4, MOV, M4V, WebM, MKV, JPG, PNG and WebP, with progress, thumbnails and duration. The server checks the extension, MIME type, size, an ffprobe stream check and a real frame decode. Images become 3-second stills.
- **Rendering:** each clip is cut and reframed to 30 fps with stereo audio, then everything is joined with `xfade`/`acrossfade` or concat. Color looks and fades are applied, and the output is H.264/AAC MP4 with faststart.
- **Validation:** before a version is saved, the output must exist and match the expected duration (within 3%) and dimensions.
- **Jobs:** job states persist (queued, validating, planning, editing, rendering, finalizing, completed, failed, cancelled). You can cancel a running job, which kills FFmpeg, and retry failed or cancelled ones. When the worker restarts, it re-queues jobs that were interrupted mid-run.
- **History:** you can create, rename and delete conversations and search Projects. **Account & usage** shows measured render time, output seconds and storage.
- **My Kit:** users import their own fonts (TTF/OTF/WOFF), .cube LUTs, logos, images, video elements, sound effects, music and saved styles from the Library panel. Files are checked by content, stored under `data/kit/`, given to the editor read-only as `kit/…`, and preferred over library defaults. Optional credit lines flow into delivery credits. See [docs/ASSET_LIBRARY.md](docs/ASSET_LIBRARY.md).
- **Voiceover:** ElevenLabs (`eleven_v4`) or Google Chirp 3 HD when a key is set, otherwise the macOS voices, clearly labelled as a draft. `polish_voice` cleans up the user's own recordings (denoise, de-ess, compression, broadcast loudness).
- **Reframing and B-roll:** `reframe_subject` follows the speaker with Apple Vision face/upper-body detection (macOS) for 9:16 crops and zoomed second angles; `find_shots` splits B-roll into shots with a contact sheet.
- **Privacy controls:** deleting a conversation also deletes its files, and "Delete all my data" wipes everything.

## Known limitations

- **Testing on your own Claude plan isn't for customers.** The `claude-cli` engine uses your personal Claude login and is meant for local testing only. It refuses to run in production. Customers need the Claude API with an API key.
- **No posting or analytics.** JANUXAI can't post to Instagram, YouTube or WhatsApp, or read account insights, so posting-time advice is general guidance.
- **No music library.** Claude suggests songs, but you add licensed music in Instagram or YouTube, or upload a track you have the rights to.
- **Premium voices need a provider key.** Without `ELEVENLABS_API_KEY` or `GOOGLE_TTS_API_KEY`, voiceovers use the synthetic macOS draft voices. The provider integrations are tested against a local mock of their APIs; check them with a real key before launch.
- **Subject tracking is macOS-only** and hasn't yet been checked on real faces. Elsewhere `reframe_subject` reports that it's unavailable.
- **Live trends need web search.** Claude can't see current trends unless the API engine runs with `JANUX_WEB_SEARCH=on`.
- **Voice-note accuracy** depends on recording quality. The `small` Whisper model is a speed and accuracy trade-off; transcripts are shown so users can check them.
- **No authentication.** It runs as a single local user and the server binds to `127.0.0.1`. Don't expose it to a network as-is.
- **Basic shot selection.** When a target length is shorter than the footage, the middle part of each clip is used. There's no scene analysis.
- **Small limits.** Output is capped at 180s and rendered at 1280 on the long edge by default (set `JANUX_OUTPUT_LONG_EDGE=1920` for 1080p).
- **Single machine.** One worker processes one job at a time, and the rate limiter is in-memory.
- Voice input uses the browser's Web Speech API (Chrome, Edge, Safari), and the mic button only appears where it's supported.

## Configuration

Copy `.env.example` to `.env.local` and change any value. All of them are optional.

## Project layout

```
src/app/                 Next.js pages and API routes
src/components/          Chat UI (JanuxApp, Composer, JobCard, TimelinePreview, VideoResult, ...)
src/lib/planner/         Request → editing spec (provider interface + rule planner)
src/lib/spec.ts          Editing specification schema (zod)
src/lib/timeline.ts      Deterministic clip-range and duration allocation
src/lib/render/          FFmpeg argument builders and the job pipeline
src/lib/media/           Safe ffmpeg/ffprobe process runner, probing, thumbnails
src/lib/*.ts             SQLite repositories, storage driver, config
worker/index.ts          Render worker process
tests/                   node:test suites (unit + real FFmpeg integration)
docs/                    Architecture, AI providers, deployment and privacy notes
```

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
