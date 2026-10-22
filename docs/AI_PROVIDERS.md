# AI engines

JANUXAI's assistant is Claude. It answers questions, plans content, edits videos, designs posters and carousels, and makes motion graphics. The worker process picks one of three engines when it starts, using `JANUX_AI`:

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

## Actions

Both engines can call the same four actions, defined in `src/lib/agent/actions.ts`:

| Action | What it does |
| --- | --- |
| `edit_video` | Queues an FFmpeg render job, as a new edit or a revision of the current version. Only changed fields are sent. |
| `create_design` | Renders 1–10 HTML/CSS slides to PNG in headless Chrome (posters, carousels, thumbnails, stories, flyers, banners). |
| `create_motion_graphic` | Queues a job that seeks CSS animations frame by frame in Chrome and encodes them to MP4. The finished MP4 can be used as a clip in `edit_video`. |
| `update_brand_kit` | Saves the business name, contacts, colours, logo and notes. |

Design pages get no network access except Google Fonts. Uploaded images are referenced as `janux-asset://<id>` and inlined as data URIs at render time.

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
