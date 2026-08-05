# VideoCaptionMaker

AI-powered video captioning & transcript search — Milestone 1 (project foundation).

## What's in this milestone

- Monorepo structure (`backend/`, `frontend/`, `legacy/`, `docs/`)
- Docker Compose orchestrating 6 services: postgres, redis, chromadb,
  backend (FastAPI), worker (Celery), frontend (Next.js)
- FastAPI hello-world with a `/api/health` endpoint and auto-generated
  `/docs`
- Next.js 14 App Router shell with Tailwind, shadcn/ui config, TanStack
  Query provider, and placeholder pages for every route the roadmap needs
  (`/login`, `/register`, `/dashboard`, `/editor/[id]`, `/search/[id]`)
- Alembic wired up for migrations (no models yet — that starts in
  Milestone 2)
- Celery app configured against Redis (no tasks yet — Milestone 4)

## Setup

1. **Copy your old scripts into `legacy/`** (optional, for reference):
   `mp4_to_mp3.py`, `mp3_to_json.py`, `preprocess_json.py`,
   `process_incoming.py`.

2. **Create your `.env`:**
   ```bash
   cp .env.example .env
   ```
   Then fill in at minimum:
   - `JWT_SECRET_KEY` — generate with:
     `python -c "import secrets; print(secrets.token_urlsafe(64))"`
   - `GEMINI_API_KEY` — get one at https://aistudio.google.com/apikey

3. **Start everything:**
   ```bash
   docker compose up -d --build
   ```

4. **GPU for Whisper (Milestone 4, not needed yet):** once we get there,
   install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
   on the host, then uncomment the `deploy.resources` block for the
   `worker` service in `docker-compose.yml` and switch `backend/Dockerfile`
   to a CUDA base image.

## Verification

```bash
# Backend health
curl http://localhost:8000/api/health     # {"status": "healthy"}
curl http://localhost:8000/docs           # Swagger UI

# Frontend
curl http://localhost:3000                # Landing page HTML

# Database connectivity
docker compose exec backend python -c "from app.database import engine; print('DB OK')"

# Run backend tests
docker compose exec backend pytest
```

All 6 containers should show as `Up` / `healthy`:
```bash
docker compose ps
```

## Project layout

See `docs/architecture.md` for the full system design and security notes.

## Roadmap

This is Milestone 1 of 10. Next up: **Milestone 2 — Authentication**
(JWT, Google OAuth, protected routes, user model, rate limiting on
auth endpoints).
