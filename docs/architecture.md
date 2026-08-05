# Architecture

## Services

| Service | Tech | Responsibility |
|---|---|---|
| `frontend` | Next.js 14 (App Router) | UI: dashboard, upload, caption editor, search |
| `backend` | FastAPI | REST API: auth, video/caption CRUD, search endpoints |
| `worker` | Celery | Long-running jobs: audio extraction, transcription, embedding, export |
| `postgres` | PostgreSQL 16 | Users, videos, captions, projects (relational data) |
| `redis` | Redis 7 | Celery broker + result backend, caching |
| `chromadb` | ChromaDB | Vector store for caption embeddings (semantic search) |

## Request flow (video upload -> transcription)

1. Frontend uploads video to `backend` (chunked upload, Milestone 3).
2. `backend` stores the file, writes a `Video` row (status: `pending`), and
   enqueues a Celery task.
3. `worker` picks up the task: extract audio (FFmpeg) -> transcribe
   (faster-whisper, GPU) -> write `Caption` rows -> generate embeddings
   (Sentence Transformers) -> upsert into ChromaDB.
4. `worker` updates `Video.status` to `completed`; frontend polls or
   receives a websocket/SSE update (TBD in Milestone 4).

## Why Celery is separate from the API process

Transcription is CPU/GPU-heavy and can take minutes. Running it inside an
API request would block the event loop and time out the HTTP connection.
Celery workers run as a separate process/container so the API stays
responsive regardless of how long a video takes to process.

## Auth model (Milestone 2)

- JWT access token (short-lived, ~30 min) + refresh token (long-lived, ~7
  days) stored in an httpOnly cookie — never in localStorage, to reduce XSS
  token theft risk.
- Google OAuth as an alternative sign-in path via Authlib.
- Passwords hashed with bcrypt (via passlib), never stored or logged in
  plaintext.

## Security notes (ongoing, not a separate milestone)

- CORS locked to the configured frontend origin only (see `CORS_ORIGINS`).
- File uploads: size-limited (`MAX_UPLOAD_SIZE_MB`), content-type validated,
  and stored outside the webroot — served only through authenticated
  backend routes, never directly.
- Secrets (`JWT_SECRET_KEY`, `GEMINI_API_KEY`, DB password) live only in
  `.env`, which is gitignored. Rotate `JWT_SECRET_KEY` before any real
  deployment — the `.env.example` placeholder is not safe to use as-is.
- Rate limiting on auth endpoints (login, register) — to be added in
  Milestone 2 to prevent brute force.
