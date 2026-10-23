# Handoff: P0 (paid beta foundation)

State at f9a8e70 (pushed to feat/mvp-chat-editor and main). Plan: docs/PRODUCTION_ARCHITECTURE.md. Hosting: AWS (Mumbai, ap-south-1).

## Done
- Installable app (PWA): manifest, icons, service worker, install prompt.
- Data layer: async `getDb()` with SQLite (local), Postgres via `DATABASE_URL` (RDS), PGlite for tests (`DATABASE_URL=pglite://memory npm test`).
- Accounts and workspaces (Better Auth): email codes via SES, optional Google, organizations = workspaces. Everything is scoped by `workspace_id`; routes use `requireAccess(req)` from `src/lib/auth/access.ts`. Kit files live in `kits/<workspace>/`. `JANUX_AUTH=on` to test locally (codes are printed to the server log).
- Idle workspace intermediates are swept by the worker.
- Tests: 78 pass on SQLite and PGlite (`npm test`), including the two-user isolation test (`tests/auth.test.ts`).

## Next: S3 uploads (not started)
1. `npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner`.
2. In `src/lib/storage.ts`, keep the local driver as the working cache and add an object store when `S3_BUCKET` is set (`S3_REGION`, optional `S3_ENDPOINT` + path-style for MinIO/R2): `persist(key)`, `materialize(key)` (download to local cache, dedupe in-flight), `remove`, `signedGetUrl`, and multipart `create / signPart / listParts / complete / abort`.
3. Upload API: `POST /api/uploads/multipart` validates type and size and records an `upload_sessions` row (workspace, key, uploadId). Then `POST .../[id]/parts` returns presigned part URLs, `GET .../[id]` lists done parts (resume), `POST .../[id]/complete` materializes the file and runs the existing ingest validation (refactor `ingestUpload` to accept a local file), and `DELETE` aborts.
4. Client `uploadFile`: 8 MB parts, 4 at a time, retries, and resume state in localStorage keyed by name + size + lastModified. Keep the raw-body upload when S3 is off.
5. Persist after writes (uploads, thumbs, outputs, kit files). Materialize before reads (`syncWorkspace` inputs and the workspace's kit, render inputs). File routes redirect to signed URLs.
6. Bucket CORS must allow PUT from the app origin and expose `ETag`.
7. Tests: a small in-process fake S3 HTTP server (path-style, signatures ignored) for end-to-end multipart.

## Then: Razorpay billing (not started)
Plans in `src/lib/plans.ts`, meters in `src/lib/usage.ts` (per workspace, not enforced yet). Add Razorpay subscriptions (keys only in server env), a webhook with signature verification that records payments, credits per workspace, and enforcement of the plan limits.
