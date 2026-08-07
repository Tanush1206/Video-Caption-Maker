# Roadmap

Ten milestones from empty repo to finished app. Each one ends in something
you can actually open and use — no milestone is pure plumbing.

| # | Milestone | Status |
|---|---|---|
| 1 | Project foundation | ✅ Done |
| 2 | Authentication | ✅ Done |
| 3 | Video upload & library | ✅ Done |
| 4 | Transcription pipeline | ✅ Done |
| 5 | Caption editor — text | ✅ Done |
| 6 | Caption editor — video & timeline | ✅ Done |
| 7 | Caption editor — styling | ✅ Done |
| 8 | Export & rendering | ✅ Done |
| 9 | Semantic search & RAG | ✅ Done |
| 10 | Dashboard & polish | Next |

---

## Milestone 1 — Project foundation ✅

Monorepo, Docker Compose across six services, FastAPI hello-world, Next.js
App Router shell with placeholder routes, Alembic wired up, Celery
configured.

**Verify:** all six containers `Up`, `/api/health` returns healthy,
`docker compose exec backend pytest` passes.

---

## Milestone 2 — Authentication

The first milestone with real database rows.

**Backend**
- `User` model — email, hashed password, `is_active`, timestamps, nullable
  `google_id` for OAuth accounts.
- First real Alembic migration.
- bcrypt password hashing via passlib. Never log or return the hash.
- JWT access token (~30 min) + refresh token (~7 days).
- Refresh token in an **httpOnly cookie**, never localStorage — see
  [architecture.md](architecture.md) for why.
- `POST /api/auth/register`, `/login`, `/refresh`, `/logout`, `GET /me`.
- Google OAuth via Authlib. Needs `GOOGLE_OAUTH_CLIENT_ID` / `_SECRET`,
  currently blank in `.env`.
- Rate limiting on login and register to blunt brute-force attempts.

**Frontend**
- Real login and register forms with Zod validation.
- Auth guard in `(dashboard)/layout.tsx` — redirect to `/login` when
  signed out.
- Token refresh on 401 inside `lib/api.ts`, retrying the original request
  once.
- Zustand store holding the current user.

**Done when:** you register, close the browser, come back still signed in.

---

## Milestone 3 — Video upload & library

**Backend**
- `Video` model — owner, filename, size, duration, `status` enum
  (`pending` / `processing` / `completed` / `failed`), timestamps.
- Chunked upload so large files survive flaky connections and are never
  buffered whole into memory.
- Validate content type and enforce `MAX_UPLOAD_SIZE_MB`.
- Store outside the webroot; serve only through authenticated routes.
- `POST /api/videos`, `GET /api/videos`, `GET /api/videos/{id}`,
  `DELETE /api/videos/{id}`.
- Extract duration and a thumbnail with FFmpeg on upload.

**Frontend**
- Drag-and-drop upload with per-file progress.
- Video grid on `/dashboard` — thumbnail, title, duration, status badge.
- Delete with confirmation.

**Done when:** a 500MB+ upload reports progress accurately and lands with
the correct duration.

---

## Milestone 4 — Transcription pipeline

The first milestone where the worker earns its keep.

**Backend / worker**
- Switch `backend/Dockerfile` to a CUDA base image; uncomment the GPU
  block in `docker-compose.yml`; install nvidia-container-toolkit on the
  host.
- Celery task chain: extract audio (FFmpeg) → transcribe (faster-whisper,
  GPU) → write `Caption` rows → embed (Sentence Transformers) → upsert
  into ChromaDB.
- `Caption` model — video FK, `start_ms`, `end_ms`, text, ordering index.
- Progress reporting to the frontend via SSE or websocket.
- Mark the video `failed` with a readable message when a stage throws. A
  stuck `processing` row is worse than an honest failure.

**Frontend**
- Live progress on the video card — queued, extracting, transcribing, %.
- Transitions to `completed` without a manual refresh.

**Done when:** a 10-minute video transcribes end to end and `nvidia-smi`
shows the GPU actually working.

> The RTX 5080 is Blackwell (sm_120) and needs a recent CUDA build. Budget
> time here — this is the most environment-fragile milestone.

Transcript text is stored **exactly as Whisper produced it**. No LLM
rewriting — see the Gemini section below.

---

## Milestone 5 — Caption editor: text

**Backend:** `PATCH /api/captions/{id}`, bulk update, split, merge.
Re-embed on edit so search stays in sync.

**Frontend:** scrollable caption list on `/editor/[id]`, inline editing,
split/merge controls, keyboard navigation, autosave with optimistic
updates, unsaved-changes warning.

**Done when:** you fix a mistranscribed word, reload, and it stuck — and
search reflects the new text.

---

## Milestone 6 — Caption editor: video & timeline

Where the editor stops being a text box and becomes a video tool.

**Frontend**
- Video player synced to the caption list both ways — the playhead scrolls
  the list, clicking a caption seeks the video.
- Waveform timeline showing caption blocks in time.
- Drag block edges to adjust `start_ms` / `end_ms`.
- Play/pause, frame stepping, playback speed.

**Backend:** authenticated video streaming with HTTP range requests, so
seeking doesn't re-download the file.

**Done when:** you drag a caption boundary, play it back, and the timing
is right.

---

## Milestone 7 — Caption editor: styling

**Backend:** `CaptionStyle` model — font, size, colour, background,
outline, position, alignment. Per video, with sensible defaults.

**Frontend:** styling panel, live preview over the video, presets
(YouTube, TikTok, minimal), per-caption overrides for emphasis.

**Done when:** the preview matches what M8 actually burns in. If they
disagree, the preview is wrong.

---

## Milestone 8 — Export & rendering

Where the work leaves the app.

**Backend / worker**
- Sidecar export: SRT, VTT, JSON.
- Burned-in rendering via FFmpeg, honouring the M7 styles.
- Celery task — rendering is slow and must not block a request.
- Progress reporting, reusing the M4 mechanism.
- Authenticated, expiring download links.

**Frontend:** export dialog with format choice, render progress, list of
past exports.

**Done when:** the rendered output matches the M7 preview, and an exported
SRT opens correctly in an external player.

---

## Milestone 9 — Semantic search & RAG

Where the Gemini key finally gets used.

**Backend**
- Semantic search over ChromaDB embeddings — meaning, not keywords.
- `GET /api/search?q=...` scoped to one video, and across the library.
- Results carry timestamps so the UI can jump straight there.
- RAG: retrieve top-k caption chunks → build a prompt → Gemini
  (`GEMINI_MODEL` in `.env`) → synthesized answer **with timestamp
  citations**.
- Handle the empty case honestly: when nothing relevant is retrieved, say
  so rather than letting the model invent an answer.

**Frontend:** search bar on `/search/[id]`, results with surrounding
context, click to jump to that moment, RAG answer panel with clickable
citations.

**Done when:** a question whose answer isn't in the video returns "not
found" instead of a fabrication. This is the test that matters.

---

## Milestone 10 — Dashboard & polish

- Real dashboard — recent videos, processing queue, storage used, counts.
- Search across the whole library, not one video at a time.
- Loading skeletons, empty states, error boundaries.
- Mobile responsive.
- Account settings, password change, delete account.
- Performance: pagination, lazy loading, cache tuning.

**Done when:** every route works on a phone-sized viewport with a
throttled connection.

---

## Where Gemini fits

**Milestone 9 only** — RAG answers over retrieved captions.

Deliberately *not* used to clean up transcripts in M4, for three reasons:

1. **Fidelity.** Captions must match what was said. An LLM rewriting them
   means the text on screen no longer matches the audio.
2. **Search integrity.** Embeddings are built from caption text. Embed
   paraphrased text and you are searching a document that never existed.
3. **Cost and latency.** Every upload would pay for an LLM pass before you
   have even decided the video is worth keeping.

**Stretch, not scheduled:** opt-in editor actions in M5–7 — rewrite this
caption, summarize this section, generate chapter markers. Explicit
actions the user triggers, never an automatic pass.

---

## Sequencing notes

- **2 → 3 → 4 is a hard chain.** No uploads without owners, no
  transcription without uploads.
- **5, 6, 7 are independently shippable.** Each leaves a usable editor.
- **8 depends on 7** for styling, **9 depends on 4** for embeddings. They
  are independent of each other and can be built in either order.
- **10 is continuous.** Polish anything at any point; the milestone is
  whatever remains at the end.
