# AI engines

JANUXAI's video editor is Claude. It edits raw footage, adds captions, effects and music, matches reference styles, and makes motion graphics. The worker process picks one of three engines when it starts, using `JANUX_AI`:

| `JANUX_AI` | Engine | Use for |
| --- | --- | --- |
| `auto` (default) | The Claude API if `ANTHROPIC_API_KEY` is set. Otherwise your local Claude Code CLI in development. Otherwise none. | Most setups |
| `api` | The Claude API (`claude-opus-5-5`, native tool use, server-side refusal fallback) | Production |
| `claude-cli` | Your installed Claude Code CLI (`claude -p`), using your own Claude login | Testing on your own machine only |
| `rules` | No AI. The keyword planner handles video edits only. | Offline work and automated tests |

The footer of the chat and **Account & usage** show which engine is active.

## Local testing with your Claude subscription (`claude-cli`)

This engine runs the official Claude Code CLI as a subprocess on your machine, signed in with your own account. Claude Code's tools are switched off (`--tools ""`), no session is saved, and it runs in an empty folder. Claude replies in text and requests JANUXAI actions through a fenced JSON block. JANUXAI validates the block with the same zod schemas the API engine uses, then executes it.

Rules for this engine:

- **It's for you only.** A personal Claude plan is for your own use. Don't let other people use a JANUXAI that runs on your login, and don't extract or reuse your login token anywhere. JANUXAI never reads it; the CLI handles sign-in.
- It refuses to run when `NODE_ENV=production`. `npm start` sets that for both processes.
- Usage counts against your plan's limits. When you hit a limit, the chat shows "Your Claude plan's usage limit was reached."

## Production (`api`)

1. Create an API key at console.anthropic.com. API usage is billed per token, separately from Claude Pro or Max.
2. Put the key in the server's `.env.local` as `ANTHROPIC_API_KEY=...`, or in your host's secret manager. Never use a `NEXT_PUBLIC_*` variable, because those are sent to the browser.
3. Optional settings:
   - `JANUX_MODEL`: defaults to `claude-opus-5-5`.
   - `JANUX_WEB_SEARCH=on`: lets Claude search the web for live trends. Searches are billed per use and capped at 3 per reply.
4. Restart the worker.

The API engine streams replies. It sends the four actions below as tools with `eager_input_streaming` and validates every input with zod before running it. Rendered design thumbnails go back to Claude in the tool result, so it can check its own work. It stops on `refusal` and `max_tokens`, and it opts into `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`), so a request the safety classifiers decline is retried on Anthropic's recommended fallback model.

## The studio toolkit

JANUXAI is a video studio. Claude edits the way a human editor would. It looks at the footage, listens to it, cuts it with FFmpeg, builds captions and motion graphics as HTML animations, checks frames of its own render, and delivers. Both engines use the same tools, defined in `src/lib/studio/tools.ts`. The API engine gets them as native tools. The local CLI engine gets them through an MCP server (`worker/mcp-studio.ts`) that Claude Code starts for each reply.

| Tool | What it does |
| --- | --- |
| `list_media` | Lists uploads and earlier outputs (`in/`) and files Claude made (`work/`) |
| `inspect_media` | Returns a contact sheet of frames with timestamps; shows reference images |
| `view_frames` | Returns up to 8 frames at chosen times. Claude uses it to pick shots and to check renders before delivering. |
| `transcribe` | Word-level timestamps from Whisper, used for cutting pauses and retakes and for timing captions |
| `analyze_audio` | Finds BPM, beat grid, accents, silences and loudness, used for beat-synced cuts |
| `run_ffmpeg` | Runs any FFmpeg edit, inside a guard (see below) |
| `render_animation` | Renders HTML/CSS/JS frame by frame, to a transparent ProRes 4444 `.mov` for overlays or an `.mp4`. Used for captions, titles, emojis, intros and motion graphics. |
| `write_file` | Writes small text files: concat lists, data, LUTs |
| `deliver` | Validates the video, converts it to H.264/AAC MP4, saves it as a version and shows it in chat |
| `update_brand_kit` | Remembers the channel or business name, handles, contacts, colours and logo |

Each conversation has a workspace at `data/workspaces/<conversation>/`. `in/` holds read-only links to uploads and outputs. Claude writes to `work/`. Transcripts and analysis are cached in `cache/`. Because intermediate files persist, a reply that was stopped or interrupted can continue from where it left off.

### Safety

- **FFmpeg guard** (`src/lib/studio/ffmpegGuard.ts`):
  - Arguments are always an array; no shell is used.
  - Every argument is checked, including filter graphs.
  - Network protocols and filters that read other files are blocked (`movie=`, `amovie=`, `sendcmd`, `zmq`, `ladspa`, `frei0r`, …).
  - Absolute paths and `..` are rejected. Outputs must go to `work/` and can't overwrite an input.
  - The concat demuxer must keep `-safe 1`.
  - Each input gets `-protocol_whitelist file`.
- **Originals are read-only.** Uploaded files are set to mode 0444.
- **Animations can't reach the internet.** They run in headless Chrome with no network access except Google Fonts.
- **Limits:** every tool has a timeout and respects Stop, and output is capped at 10 minutes.

## Voice notes

Voice notes are transcribed locally by whisper.cpp using the multilingual `small` model. Whisper detects the language automatically, including Tamil, Malayalam, Telugu, Kannada, Hindi, English and about 90 others. Claude receives the transcript and replies in the same language. The audio never leaves the computer.

Set it up with `npm run setup:speech`, which runs `brew install whisper-cpp` and downloads `data/models/ggml-small.bin` (about 466 MB). To change the paths, set `WHISPER_CLI` and `WHISPER_MODEL`. For better accuracy on long recordings, swap in `ggml-medium.bin`; it is slower.

## What's sent to Claude

Claude receives:

- your messages and voice-note transcripts
- the brand kit
- the names, types, durations and sizes of files in the conversation
- the current edit spec
- on the API engine only, thumbnails of designs it rendered

Uploaded videos, audio and photos stay on the machine.
