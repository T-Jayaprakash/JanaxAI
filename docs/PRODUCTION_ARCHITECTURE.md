# Production architecture

This plan takes JANUXAI from a single-machine MVP to a paid service. It's meant to serve thousands of creators and businesses, on any phone or computer, from 30-second reels up to full-length YouTube videos.

## 1. What we keep and what changes

**Keep (our moat):** the editing agent, its studio tools, the FFmpeg safety guard, the deterministic Chrome motion-graphics renderer, the asset library and My Kit, and live activity with honest progress. Together these are already an API: each tool is a typed function with validated input.

**Change for production:**

| MVP today | Production |
| --- | --- |
| Claude Code CLI on the developer's Pro login (dev only) | Claude API with a server-side key, prompt caching and per-edit cost metering |
| SQLite on one disk | Postgres for data, Redis for queues, rate limits and live events |
| Files in `data/` on one disk | Object storage (Cloudflare R2 or S3) with resumable multipart uploads from phones |
| One worker process: a crash fails the reply | Durable workflows: every tool call is a retryable step and replies resume after a crash |
| Agent runs ad-hoc FFmpeg on the whole video | A **timeline (edit decision list) model** as the source of truth, rendered in parallel chunks |
| No accounts | Auth, workspaces (a brand or agency with members), plans, credits, billing |
| Web page | Installable PWA now, a native app (Expo) later, a public REST API with webhooks |

## 2. System overview

```
 Phone app / PWA / Web / Partner API
              │  HTTPS + SSE
      ┌───────▼────────┐        ┌─────────────┐
      │  API service   │───────▶│  Postgres   │
      │ auth, projects │        └─────────────┘
      │ billing, SSE   │───────▶ Redis (queues, live events, rate limits)
      └───┬───────┬────┘
 presigned│       │start workflow
 uploads  │  ┌────▼─────────────────────────┐
      ┌───▼──┴┐ │  Workflow engine          │   Temporal (or Inngest)
      │  R2   │ │  agent run = workflow     │
      │ + CDN │ │  tool call  = activity    │
      └───▲───┘ └──┬──────────┬──────────┬─┘
          │        │          │          │
          │  ┌─────▼───┐ ┌────▼─────┐ ┌──▼─────────┐
          └──┤ Agent   │ │ Media    │ │ GPU        │
             │ workers │ │ workers  │ │ workers    │
             │ Claude  │ │ FFmpeg + │ │ Whisper,   │
             │ API     │ │ Chrome   │ │ face track,│
             └─────────┘ │ (no net) │ │ stems, TTS │
                         └──────────┘ └────────────┘
```

- **API service:** auth, projects, uploads, billing and live updates. Next.js route handlers work at first; split into a separate Node service when traffic needs it.
- **Workflow engine:** an agent reply is a workflow, and every studio tool call is an activity with retries and a timeout. If a worker dies mid-render, the workflow picks up on another worker at the last finished step instead of telling the user "interrupted".
- **Agent workers:** cheap CPU containers that only talk to the Claude API and dispatch tool activities.
- **Media workers:** autoscaled CPU containers with FFmpeg and headless Chrome. They pull inputs from R2 and push outputs back. **No outbound network** except storage, plus a per-job sandbox (container, read-only root, seccomp/gVisor) on top of the FFmpeg argument guard.
- **GPU workers (on demand):** serverless GPUs (Modal, RunPod or similar) for transcription, face tracking, stem separation and upscaling, scaled to zero when idle.
- **Region:** Mumbai (AWS ap-south-1 or GCP asia-south1). It's closest to Tamil Nadu customers. Storage and render workers must sit in the same region.

## 3. Long videos (YouTube, 10–60 min)

The reel pipeline won't scale to an hour of 4K footage. Long videos need four changes.

1. **Proxy-first ingest.** On upload, workers make a 540p/720p proxy, a 16 kHz mono audio track, a transcript with word timings, a scene index and contact sheets. The agent works only on these, which is fast and cheap.
2. **Timeline as the source of truth.** The agent edits a JSON timeline: clips with source in/out, layers (captions, graphics, B-roll, logo), audio tracks with ducking, transitions and looks. It no longer writes one giant FFmpeg command. Revisions like "make the intro faster" become small diffs to the timeline, and every version is stored. The same model can later drive a manual timeline UI. OpenCut (MIT) is a good reference for that UI.
3. **Text-based editing.** For talking videos, the transcript is the editor: cut a sentence, and the clip is cut. This is the Descript model, and it fits chat perfectly ("remove the part where I talk about pricing").
4. **Segmented parallel render.** The timeline is split into roughly 30–60 s chunks at cut points. Each chunk renders on its own worker from the original footage. Chunks are joined with stream copy, and loudness is normalised over the whole programme. A 30-minute video renders in a few minutes instead of an hour.

Plan limits (minutes per video, resolution, renders per month) are enforced in the API before any work starts.

## 4. Phones and partners

- **Now:** add a web app manifest and service worker so the app installs on Android and iPhone home screens. Uploads use resumable chunks (tus protocol, or S3 multipart with presigned parts), so a dropped mobile connection resumes instead of restarting. Voice notes and dictation already work in mobile browsers.
- **Next:** a native app with Expo (React Native) on the same API. It adds share-sheet upload ("Share → JANUXAI" from the gallery or Instagram drafts), background uploads, push notifications when a render is done, and saving to the camera roll.
- **Public API:** `POST /v1/projects`, `POST /v1/projects/{id}/uploads`, `POST /v1/projects/{id}/messages` (the same chat instruction), `GET /v1/renders/{id}`, and webhooks for `render.completed`. Agencies and apps can then automate edits with their own API keys and usage billing.

## 5. Providers (paid APIs) and open source

### AI and speech providers

| Need | Primary | Alternatives | Notes |
| --- | --- | --- | --- |
| Editing agent | Claude API (Opus for planning, Sonnet/Haiku for subtasks) | — | Prompt-cache the system prompt and tools; meter tokens per edit |
| Speech-to-text | Self-hosted Whisper large-v3 / faster-whisper on GPU | [Sarvam](https://docs.sarvam.ai/api/pricing) speech-to-text (about ₹30/hour), Deepgram, AssemblyAI | Benchmark Tamil and Tanglish accuracy on real customer clips before choosing |
| Premium voiceover | ElevenLabs `eleven_v4` | [Sarvam Bulbul v3](https://docs.sarvam.ai/api-reference-docs/models/bulbul) (Tamil and 10 more Indian languages, about ₹30 per 10K characters), Google Chirp 3 HD | Already behind our voice provider abstraction |
| Voice cloning (creator's own voice) | ElevenLabs | — | Needs recorded consent from the voice owner |
| Stock B-roll and music | Pexels / Pixabay APIs (check app terms), or a licensed music API | — | Licence per use; credits through our licence tracking |

### Open-source building blocks

| Component | Use | Licence |
| --- | --- | --- |
| FFmpeg | All cutting, mixing, encoding | LGPL/GPL (server-side use is fine; don't ship GPL builds inside the mobile app) |
| Our Chrome renderer | Motion graphics, captions | Ours. Avoids [Remotion's company licence](https://www.remotion.dev/docs/license/pricing): automators pay $0.01 per render with a $100/month minimum |
| Motion Canvas / Revideo | Alternative code-driven animation engines | MIT |
| whisper.cpp, faster-whisper, WhisperX | Transcription, word alignment | MIT / BSD |
| Silero VAD | Silence and pause detection | MIT |
| auto-editor | Reference for silence and dead-air cutting | Public domain (Unlicense) |
| PySceneDetect | Scene and shot detection for B-roll and long videos | BSD-3 |
| MediaPipe | Face and pose tracking for auto-reframe and zooms | Apache 2.0 |
| Demucs | Separate voice and music (remove music, clean dialogue) | MIT |
| DeepFilterNet | Speech denoising (better than FFmpeg filters) | MIT / Apache 2.0 |
| Real-ESRGAN | Upscale low-quality phone footage | BSD-3 |
| AI4Bharat Indic TTS models | Self-hosted Tamil TTS once volume justifies GPUs | Check each model's licence |
| [OpenCut](https://github.com/OpenCut-app/OpenCut) | Reference for a manual timeline editor UI | MIT |

Every component keeps its licence recorded, the same way the asset library does.

## 6. Money: plans, credits, billing

- **Billing:** Stripe for international cards in USD, and Razorpay for India (UPI and INR cards). Both handle subscriptions and webhooks. Never store card data ourselves.
- **Credits = output minutes**, which users understand ("1 credit = 1 minute of finished video"). Internally, meter four costs per edit: Claude tokens, CPU render seconds, GPU seconds, and TTS characters. The `usage_records` table already records render time; extend it with tokens and provider costs.
- **Pricing rule:** price each plan from the measured cost of a typical edit, at **at least 3× gross margin**. Revisions should be cheap (timeline diffs plus a partial re-render) so users iterate without fear.
- **Cost controls:** the agent gets a budget per reply (maximum turns, tokens and render minutes). It plans on proxies, routes simple subtasks to cheaper models, and caches transcripts and analyses per file hash.

## 7. Trust and safety

- Auth with email/OTP and Google sign-in (Clerk, Supabase Auth or Auth.js). Every query is scoped to a workspace.
- Signed, short-lived URLs for every file. Delete originals after a per-plan retention period, with a one-click "delete my data".
- Rate limits and quotas per user and per API key.
- Content moderation on uploads and prompts. No editing that impersonates real people without consent.
- Secrets live only in the server environment; nothing reaches the browser or the model.
- Monitoring: error tracking (Sentry), traces per workflow, and alerts on failed renders and provider errors.

## 8. Roadmap

| Phase | Scope | Outcome |
| --- | --- | --- |
| **P0: Paid beta** (2–3 weeks) | Claude API key, auth and workspaces, Postgres, R2 with resumable uploads, Razorpay + Stripe, PWA install, deploy in Mumbai with one media worker pool | Real customers can pay, on phone or desktop |
| **P1: Scale and long-form** | Workflow engine, timeline model, proxies, parallel chunk render, autoscaling workers, 60-minute videos, cost metering | Reliable at volume; YouTube creators |
| **P2: Everywhere** | Public API + webhooks, Expo app with share sheet and push, team workspaces, brand kits per client | Agencies, partners, app-store presence |
| **P3: Pro features** | GPU features (face-tracked reframing, stem separation, denoise, upscale), voice cloning with consent, manual timeline editor | Premium tier |

## 9. Decisions needed before P0

1. **Hosting:** managed containers (Fly.io or Render) for speed of setup, or AWS (ECS + S3 + RDS) for long-term cost and control.
2. **Billing currency:** INR-first (Razorpay) or USD-first (Stripe). Both are possible, but launch with one.
3. **Free tier:** for example, 3 watermarked minutes per month, to limit abuse and GPU cost.
4. **Speech-to-text default for Tamil:** a measured comparison of Whisper and Sarvam on 20 real customer clips.
