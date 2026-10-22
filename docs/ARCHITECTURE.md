# Architecture

```
Browser (chat UI)
  │  POST /api/uploads  (raw bytes → streamed to disk → ffprobe + thumbnail)
  │  POST /api/conversations/:id/messages
  │        → planner → validated EditSpec → buildTimeline → jobs row (queued)
  │  GET  /api/conversations/:id/events   (SSE, polls SQLite every 600ms)
  ▼
Next.js server ──── SQLite (WAL) ──── Render worker (separate process)
                     data/janux.db        claimNextJob() → processJob()
                     data/uploads/         inspect → plan → cut → render → validate → preview
                     data/outputs/         FFmpeg via argument arrays, timeouts, cancel polling
                     data/thumbs/
                     data/tmp/<job>/       deleted after every job
```

## Why it's built this way

- **Separate worker process.** Renders keep running when the browser closes and never block HTTP requests. Job state lives in SQLite, so a page refresh or reconnect picks it up again.
- **SQLite in WAL mode.** It needs no setup, and both processes can use it at once. All SQL is in `src/lib/{db,jobs,conversations,assets}.ts`, so a move to PostgreSQL touches only those files.
- **SSE polling SQLite** instead of a message bus. It's simple and fast enough for one machine. With several web servers, replace it with Postgres `LISTEN/NOTIFY` or Redis pub/sub.
- **Spec → timeline → commands.** `buildTimeline()` is a pure function, and both the chat preview and the renderer use it, so the preview shows what will actually be rendered. `render/commands.ts` builds FFmpeg argument arrays from numbers and enums only.
- **Honest progress.** A stage is marked done only after its work finishes. Progress percentages come from FFmpeg's `-progress` output. Unsupported requests appear as "not available yet" stages.

## Data model

| Table | Holds |
| --- | --- |
| `conversations` | Title and timestamps |
| `messages` | Role, text, attachment asset IDs, `job_id`, and `version_id` (the version this message produced or showed) |
| `assets` | Uploads and outputs: generated storage key, MIME type, size, probe metadata, thumbnail |
| `jobs` | Spec, plan info, timeline, state, stages (JSON), error (diagnostic kept server-side), attempts, cancel flag, heartbeat |
| `versions` | Numbered per conversation, with parent version, output asset and the exact spec used |
| `usage_records` | Render wall time, input and output bytes, output seconds, AI calls (0 today), success |
| `meta` | Worker heartbeat |

Revisions start from the **base version**: the latest message that produced or showed a version. "Go back to version 2" moves the base without rendering anything.

There's no `users` table yet. Add one together with authentication, then add `user_id` to `conversations` and `assets` and check ownership in every route. `src/app/api/assets/[id]/file/route.ts` marks where that check goes.

## Failure handling

| Case | Behaviour |
| --- | --- |
| Corrupt or unsupported upload | Rejected at upload by ffprobe and a frame decode, and the partial file is deleted |
| File removed after upload | Job fails with `missing_input` and a clear message |
| FFmpeg error | User sees a safe message mapped from stderr (corrupt file, missing codec, no disk space); the stderr tail is stored internally |
| Timeout | FFmpeg is killed after `JANUX_FFMPEG_TIMEOUT_SEC` |
| Low disk | Checked before uploads and before rendering (`JANUX_MIN_FREE_DISK_MB`) |
| Bad output | Must exist and match the expected duration and dimensions, or the job fails |
| Worker crash | Active jobs are re-queued when the worker starts, up to `JANUX_MAX_JOB_ATTEMPTS` |
| Cancel | Queued jobs cancel at once; running jobs have FFmpeg killed within about 0.5s |
| Retry | Resets the same job with fresh stages, keeping its spec and inputs |

## Production checklist (not done yet)

Before this goes beyond a private prototype:

- [ ] Authentication, a `users` table, and ownership checks on every route
- [ ] PostgreSQL, S3-compatible object storage (add a `StorageDriver` implementation) and signed download URLs
- [ ] A real queue or `SELECT … FOR UPDATE SKIP LOCKED` workers, run as separate services with CPU and memory limits
- [ ] A shared rate limiter, request size limits at the proxy, and HTTPS
- [ ] A retention policy (for example, delete uploads after N days) and a scheduled cleanup job
- [ ] A privacy policy that covers footage storage and any AI providers
- [ ] Payments only after costs are measured: a server-verified gateway with webhooks, an idempotent credit ledger, and a refund policy for failed jobs. This code should stay isolated from the editing engine.
- [ ] Monitoring for failed jobs, render time and disk usage

## Cost notes

Measured on an Apple Silicon laptop: a 15s 720×1280 reel from 3 short clips renders in about 3–6s of wall time and produces about 2–5 MB. The Account panel shows totals from `usage_records`. Measure on your target server before setting prices. No GPU or paid service is used.
