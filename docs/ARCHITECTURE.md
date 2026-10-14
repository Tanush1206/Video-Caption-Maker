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
  token theft risk. The access token is held in memory on the client for the
  same reason.
- Access tokens carry a `type` claim, so a refresh token cannot be presented
  as an access token, and a `jti`, so individual tokens can be revoked.
- Logout revokes the refresh token through a Redis denylist keyed by `jti`
  and expiring with the token. Clearing the cookie alone would leave a
  captured token working until it expired.
- Google OAuth as an alternative sign-in path. Implemented with `httpx`
  directly and CSRF state in Redis, rather than Authlib's Starlette
  integration, which would need session middleware and wouldn't survive
  running more than one API instance.
- Passwords hashed with **bcrypt directly**, never stored or logged in
  plaintext. Not via passlib: its final release (1.7.4, 2020) probes the
  backend with an over-length test password, which bcrypt >= 5 rejects
  rather than truncating, so every hash call raised.
- Login returns an identical response for a wrong password and an unknown
  email, and performs a dummy hash comparison when no user is found, so the
  endpoint is not an account-existence oracle by status or by timing.

## Security notes (ongoing, not a separate milestone)

- CORS locked to the configured frontend origin only (see `CORS_ORIGINS`).
- File uploads: size-limited (`MAX_UPLOAD_SIZE_MB`), content-type validated,
  and stored outside the webroot — served only through authenticated
  backend routes, never directly.
- Secrets (`JWT_SECRET_KEY`, `GEMINI_API_KEY`, DB password) live only in
  `.env`, which is gitignored. Rotate `JWT_SECRET_KEY` before any real
  deployment — the `.env.example` placeholder is not safe to use as-is.
- Rate limiting on auth endpoints (login, register), backed by Redis rather
  than per-process counters — otherwise an attacker gets N times the
  allowance by spreading requests across workers. Login is limited per IP
  *and* per email: the IP bucket stops one host spraying many accounts, the
  email bucket stops many hosts spraying one account. It fails open, since a
  Redis blip taking down login entirely is worse than the brute-force window
  it protects; the token denylist fails closed, for the opposite reason.
