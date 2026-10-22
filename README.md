# JANUXAI

**Just tell it. It'll make the video.**

JANUXAI is a conversational video editor. Upload clips, describe the video you want in chat, watch the real editing steps run, and get back an MP4 you can preview, download and revise by chatting.

This is a private local prototype. It edits with FFmpeg on your own computer.

## Quick start

Requirements: Node.js 20 or newer (tested on 22), npm, and FFmpeg with `ffprobe` on your `PATH` (`brew install ffmpeg` on macOS).

```bash
npm install
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

## The MVP journey

1. Open JANUXAI and attach two or more clips (paperclip button, drag and drop, or paste).
2. Type "Combine these clips into a 15-second vertical reel" and press Enter.
3. A job card appears and shows each real pipeline step with live FFmpeg progress.
4. Open the **Timeline** tab to see which part of each clip is used, or **Edit spec** for the exact JSON spec.
5. When the output passes validation, the video appears inline. You can play it, download it, or tap a revision chip.
6. Ask for a change ("make it 8 seconds and 16:9"). This creates version 2 from version 1's spec, and earlier versions are kept.
7. Refresh the page. The conversation, jobs and versions come back from SQLite, and a job that's still running keeps streaming.

## What works today

The chat understands these requests:

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
- **Privacy controls:** deleting a conversation also deletes its files, and "Delete all my data" wipes everything.

## Known limitations

- **No AI model.** Planning is keyword-based (`src/lib/planner/rules.ts`). Every job card says "Rule-based planner (keyword matching, no AI model)". See [docs/AI_PROVIDERS.md](docs/AI_PROVIDERS.md) for adding an LLM planner.
- **No authentication.** It runs as a single local user and the server binds to `127.0.0.1`. Don't expose it to a network as-is.
- **No captions or text overlays yet.** The FFmpeg build tested here has no `drawtext` or `libass`, and speech-to-text isn't configured.
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
