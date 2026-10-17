# Architecture

How VideoCaptionMaker is built, as of v1.0.6 (released 2026-10-15). Every statement points at the
file it comes from. Auth and the request guard are in
[SECURITY.md](SECURITY.md); tables are in [DATABASE.md](DATABASE.md); endpoints
are in [API.md](API.md).

## 1. System overview

Six containers under Docker Compose: a Next.js UI, a FastAPI API, a Celery
worker, Postgres, Redis and ChromaDB. The API and the worker are **one image**
started with different commands (`api` / `worker` in
`backend/docker-entrypoint.sh`). Only the UI port is published, on
`127.0.0.1:${VCM_PORT:-3000}` (`docker-compose.prod.yml`). The browser never
talks to the API directly: Next rewrites `/api/*` to `http://backend:8000`
(`frontend/next.config.js`).

| Service | Image (prod) | Role |
|---|---|---|
| `frontend` | `ghcr.io/tanush1206/video-caption-maker-frontend:<ver>` (Node 20 Alpine, Next standalone) | UI and same-origin `/api` proxy |
| `backend` | `…-backend:<ver>-<cpu\|cuda>`, command `api` | runs `alembic upgrade head`, then uvicorn on :8000 |
| `worker` | same image, command `worker` | Celery, `--pool=solo`: transcription, translation, embedding, rendering |
| `postgres` | `postgres:16.14-alpine` | relational data |
| `redis` | `redis:7.4.10-alpine`, no persistence | Celery broker and result backend; rate-limit buckets and denylist (accounts mode) |
| `chromadb` | `chromadb/chroma:1.0.0` | caption embeddings for semantic search |

## 2. How the services communicate

```mermaid
flowchart LR
    B["Browser<br/>http://localhost:VCM_PORT"] -->|"HTTP, same origin"| F["frontend<br/>Next.js :3000"]
    F -->|"rewrite /api/* → backend:8000<br/>(X-Forwarded-Host kept)"| A["backend<br/>FastAPI :8000"]
    A -->|"SQLAlchemy asyncpg"| P[("postgres :5432")]
    A -->|"task.delay()"| R[("redis :6379")]
    A -->|"query vectors<br/>(search only)"| C[("chromadb :8000")]
    R -->|"deliver task (acks_late)"| W["worker<br/>Celery solo"]
    W -->|"progress, captions, results"| P
    W -->|"upsert / delete vectors"| C
    A <-->|"media volume<br/>/app/storage"| M[("media")]
    W <-->|"read source, write exports"| M
    W -->|"model weights"| HF[("models volume<br/>/root/.cache/huggingface")]
    W -. "first use only" .-> HUB["huggingface.co"]
    A -. "font on demand" .-> GF["raw.githubusercontent.com<br/>google/fonts"]
    W -. "only with a key" .-> G["Gemini API"]
    A -. "only with a key<br/>(/api/ask)" .-> G
```

**Rules that follow from this:**

- The browser **must** only call relative `/api/...` paths. `API_URL` is
  empty in production builds (`frontend/src/lib/config.ts`); the dev compose
  sets it to `http://localhost:8000`.
- The API **never** runs a long job in a request. It writes a row, calls
  `.delay()`, and returns. The worker writes progress into the row in its own
  short session (`_set_progress` in `backend/app/workers/transcription.py`),
  and the UI polls:
  - the video list every 2 s while anything is `pending`/`processing`
    (`frontend/src/hooks/use-videos.ts`);
  - exports every 1.5 s while one is rendering (`use-exports.ts`);
  - transcription alerts every 3 s (`use-transcription-alerts.ts`).

  Polling stays: progress changes a few times a minute ([DECISIONS.md](DECISIONS.md) D10).
- **Forwarded headers are believed only from the frontend.** uvicorn runs with
  `--no-proxy-headers` (`backend/docker-entrypoint.sh`). The
  `TrustedProxyHeaders` middleware (`backend/app/proxy_headers.py`, the
  outermost layer in `main.py`) applies `X-Forwarded-For`/`-Proto` only when
  the peer is an address that `TRUSTED_PROXIES` (default `frontend`)
  resolves to. It re-resolves at most every 5 s, because a recreated frontend
  container gets a new IP and Docker can hand the old one to another
  container. The frontend overwrites both headers with its own socket's peer
  before proxying (`frontend/forwarded-for.js`, preloaded with `node -r`), so
  `audit.log`'s client can't be forged. For a browser on the host, that peer
  is Docker's gateway ([SECURITY.md](SECURITY.md) §4a).

  Polling was chosen over SSE or websockets (see [DECISIONS.md](DECISIONS.md)).
- Only the worker sees the GPU. At `worker_ready` it writes a hardware report
  to `app_settings.worker_hardware`; the API reads that rather than probing its
  own GPU-less container (`backend/app/workers/celery_app.py`,
  `backend/app/api/system.py`).

### Shared volumes (prod)

| Volume | Mounted at | In | Holds |
|---|---|---|---|
| `db` | `/var/lib/postgresql/data` | postgres | database |
| `vectors` | `/data` | chromadb | vector store |
| `media` | `/app/storage` | backend, worker | uploads, thumbnails, waveforms, exports, `audit.log` |
| `models` | `/root/.cache/huggingface` | backend, worker | Whisper, M2M100, MiniLM weights |
| `fonts` | `/usr/share/fonts/truetype/vcm-cache` | backend, worker | Google Fonts fetched on demand |
| `./certs` (bind, ro) | `/usr/local/share/ca-certificates/extra` | backend, worker | optional extra root CAs |

## 3. Project structure

```
.
├── backend/
│   ├── app/
│   │   ├── main.py              FastAPI app: CORS, request guard middleware, router
│   │   ├── config.py            every env setting, typed (pydantic-settings)
│   │   ├── database.py          async engine + Base + get_db
│   │   ├── dependencies.py      CurrentUser / DbSession (local mode → the one user)
│   │   ├── request_guard.py     local-mode host/origin guard + audit.log
│   │   ├── proxy_headers.py     X-Forwarded-* believed only from the frontend
│   │   ├── api/                 routers, one per resource; thin, call services
│   │   ├── schemas/             Pydantic request/response models
│   │   ├── models/              SQLAlchemy ORM models (one table per file)
│   │   ├── services/            all logic: hardware, transcription, translation,
│   │   │                        embeddings, search, rag, rendering, storage…
│   │   ├── workers/             Celery app and tasks; recovery at startup
│   │   ├── utils/               JWT/bcrypt, rate limit, filenames, denylist
│   │   └── data/google_fonts.json   generated font catalogue
│   ├── alembic/versions/        13 migrations (see DATABASE.md)
│   ├── tests/                   pytest suite (runs against the dev stack)
│   ├── scripts/build_font_catalogue.py
│   ├── Dockerfile               targets: deps → runtime → dev; VARIANT=cpu|cuda
│   ├── Dockerfile.dockerignore  allow-list for the root build context
│   ├── docker-entrypoint.sh     api | worker | exec
│   ├── pyproject.toml, constraints.txt, pytest.ini, alembic.ini, ruff.toml
├── frontend/
│   ├── src/app/                 App Router: (dashboard)/{dashboard,editor/[id],search,search/[id],settings},
│   │                            (auth)/{login,register} (accounts mode only), healthz/
│   ├── src/components/          ui/ primitives, layout/, videos/, captions/, styles/,
│   │                            exports/, search/, settings/, flow/, player/, dashboard/
│   ├── src/hooks/               TanStack Query hooks, one per resource
│   ├── src/lib/                 api client, config, utils (cn), stages, format…
│   ├── src/stores/auth.ts       Zustand: in-memory access token + user
│   ├── src/types/               TS types mirroring the API schemas
│   ├── src/middleware.ts        local mode: / /login /register → /dashboard
│   ├── public/fonts/            caption fonts (also copied into the backend image)
│   ├── tailwind.config.ts, next.config.js, Dockerfile
├── install/                     install.sh, install.ps1, vcm, vcm.ps1, vcm.cmd
├── scripts/                     e2e.py, update_layers.py, ui-check/ (Playwright + axe)
├── docker-compose.yml           dev stack (bind mounts, hot reload)
├── docker-compose.prod.yml      installed app (project `vcm`)
├── docker-compose.gpu.yml       NVIDIA override for either
└── .github/workflows/           ci.yml, release.yml
```

## 4. The job pipeline

### 4.1 Transcription (`transcribe_video`, `backend/app/workers/transcription.py`)

```mermaid
sequenceDiagram
    participant UI as Browser
    participant API as backend
    participant Q as redis
    participant W as worker
    participant DB as postgres
    participant V as chromadb
    UI->>API: POST /api/videos (file, caption_language)
    API->>API: stream to /app/storage/user_N/<uuid>.<ext>, ffprobe duration, thumbnail
    API->>DB: INSERT videos (status=pending)
    API->>Q: transcribe_video.delay(id)
    API-->>UI: 201 VideoRead
    Q->>W: deliver (prefetch 1, acks_late)
    W->>DB: read languages, Settings (whisper_model, gemini key)
    W->>DB: DELETE captions; W->>V: delete vectors (idempotent re-run)
    W->>W: 0 downloading: load Whisper (unloads translator)
    W->>W: 1 extracting: FFmpeg → <src>.transcode.wav
    W->>W: 2 transcribing: detect language (30 s) if auto, then decode
    W->>W: 2b translating: Gemini → fallback M2M100 (unloads Whisper)
    W->>DB: INSERT captions
    W->>V: 4 embedding: upsert "{video}:{caption}" vectors
    W->>DB: status=completed, notice
    loop every 2 s while busy
      UI->>API: GET /api/videos
    end
```

Stage names are fixed strings, written to `videos.stage`: `downloading`,
`extracting`, `transcribing`, `translating`, `embedding`. The UI labels for
them are in `frontend/src/lib/stages.ts`.

Rules the code enforces:

- **Idempotent.** A run deletes the video's captions and vectors before
  writing new ones. That is what makes `task_acks_late=True` and requeueing
  safe.
- **The WAV is always deleted** (`finally`).
- **Indexing failure is not job failure.** Captions are kept and search
  degrades.
- **Translation failure is not job failure.** Captions stay in the spoken
  language, with a notice.
- **Any other exception** marks the video `failed` with a sentence from
  `friendly_error` (truncated to 500 chars), then re-raises so Celery records
  it.
- **Settings are read per job, not per process**, so a model change in
  Settings applies to the next job.

### 4.2 Caption edits → `reindex_captions`

Text edits, adds, splits, merges and deletes queue `reindex_captions(video_id)`
(`backend/app/api/captions.py`, `videos.py`). It re-embeds **the whole
video**: it deletes the vectors, then upserts all current captions. Failure is
logged and never surfaced to the user.

### 4.3 Export (`render_export`, `backend/app/workers/export.py`)

- SRT, VTT and JSON are written **inside the request**
  (`export_service.write_sidecar`) and return `completed`.
- MP4 creates an `exports` row (`pending`) and queues `render_export`:
  1. build an ASS file from the captions and style (`services/subtitles.py`);
  2. run FFmpeg with `scale` **before** `ass` (`_filter_chain`), so glyphs
     are drawn at the output size. `ass`, not `subtitles`: the same libass,
     but the only one of the two that accepts `shaping=complex`, without
     which Indic scripts were drawn unshaped (v1.0.7);
  3. encode with `h264_nvenc` (`-cq 19 -preset p6`) when it works, otherwise
     `libx264 -crf 18 -preset medium` (`services/rendering.py`);
  4. write the progress from FFmpeg's `out_time_us`.
- The output goes to `user_N/exports/<uuid>.<fmt>`. A retry writes a new
  file, never resuming a partial one.
- **Preview = burn.** `lib/caption-style.ts` is the browser twin of
  `to_ass_style`, and three rules keep them at the same size and shape
  (v1.0.7, measured within ~1.5% on burned frames):
  - libass makes a face's whole win cell (usWinAscent + usWinDescent) the
    font size; CSS makes the em the font size. The style serves the face's
    ratio (`font_win_span`); the preview divides by it and uses it as the
    line height;
  - **one layout rule** (`services/caption_layout.py`, mirrored line for
    line in `lib/caption-layout.ts`) decides each caption's lines, size and
    position: the box's width (`box_width`, or 80%/85% by the frame's shape),
    balanced wrapping inside it, the Max lines shrink (2% steps to 70%, then
    one extra line), the centre (`pos_x`/`pos_y`) and the slide into the 3%
    safe area. Widths come from HarfBuzz (`uharfbuzz`) on the files libass
    draws with, and from canvas `measureText` in the browser. The ASS gets
    the result per event, `{\an5\pos(x,y)\fs<size>}line\Nline`, under
    WrapStyle 2 with zero margins, so libass neither wraps nor places on its
    own. `scripts/ui-check` `layout-parity` compares the two copies through
    `backend/scripts/caption_layout.py`;
  - Devanagari, Bengali, Tamil and Malayalam are drawn in vendored Noto
    faces (`SCRIPT_FONTS`, `frontend/public/fonts`): the ASS names the face
    per run with `\fs` scaled to the caption font's em; CSS lists the faces
    first, each limited to its script with `unicode-range`. Cyrillic gets
    the same treatment (Noto Sans) only when the caption font's own charset
    (`fc-query`) lacks it; the style serves the resulting `script_font_stack`.
- A box (`box_opacity > 0`, BorderStyle 3) is filled by libass with
  **OutlineColour**, so that field carries the box colour and opacity when
  boxed.
- Render timeout: 3 h (`RENDER_TIMEOUT_SECONDS`), enforced by the FFmpeg
  subprocess itself.
- **No Celery time limits** (`task_soft_time_limit`/`task_time_limit` are
  `None` in `celery_app.py`). Until v1.0.5 they were 30/35 min, which would
  have killed long CPU transcriptions and multi-hour renders, except that
  `--pool=solo` never enforces Celery limits. (Measured: a 6 s task under a
  3 s hard limit ran to completion.) A job is bounded by the timeouts of the
  steps that can hang, listed in §8. `tests/test_worker_config.py` pins this.

## 5. Hardware detection and model choice

`backend/app/services/hardware.py`, run in the worker:

1. `detect()` (cached per process):
   - `cuda` = `ctranslate2.get_cuda_device_count() > 0`;
   - GPU name and VRAM from `nvidia-smi`;
   - RAM = **min(MemTotal, cgroup limit)** (`/sys/fs/cgroup/memory.max` or
     the v1 equivalent);
   - CPU count.
2. `whisper_profile(hw, user_model)`:
   - **Model precedence:** the Settings choice (`app_settings.whisper_model`),
     then `WHISPER_MODEL_SIZE`, then the tier.
   - **Tier:**
     - CUDA with VRAM ≥ 6 GB, or unknown: `large-v3`.
     - CUDA with less VRAM: `small`.
     - CPU with RAM ≥ 12 GB: `large-v3-turbo`.
     - Otherwise: `small`.
   - **Device:** `WHISPER_DEVICE`, unless it asks for `cuda` without CUDA.
   - **Compute:**
     - CUDA: `float16` for large/medium, `int8_float16` otherwise.
     - CPU: `int8`. A `float16` setting on a CPU is overridden, because
       CTranslate2 has no CPU float16 kernel.
3. `translator_profile(hw)`:
   - Model: `TRANSLATION_MODEL`, or `auto`, which means `m2m100_1.2B` with
     RAM ≥ 12 GB and `m2m100_418M` otherwise.
   - Device: on CUDA, the GPU (`int8_float16`); otherwise the CPU (`int8`).
4. **Load fallback.** If Whisper or M2M100 fails to load on CUDA (a driver too
   old, unsupported card, VRAM in use), the worker retries on the CPU with
   `int8`. Whisper's fallback adds a notice to the job.
5. **Memory rule.** `transcription.load_model` calls `translation.unload()`
   first, and `translation._load` calls `transcription.unload_model()` first.
   The two models are **never** resident together.

Model weights go through `services/model_store.py`:
- they download into the `models` volume with progress measured from bytes
  on disk;
- `HF_HUB_DISABLE_XET=1` makes downloads plain HTTP, so they are resumable and
  show progress;
- certificate failures become `ModelDownloadError` with the `certs/`
  instructions.

## 6. Translation engines and fallback

`backend/app/services/translation.py`

```mermaid
flowchart TD
    S{"caption_language"} -->|same| N["no translation"]
    S -->|en| WT["Whisper task=translate<br/>(same pass, any spoken language)"]
    S -->|"any other caption language"| D{"detected == target?"}
    D -->|yes| N
    D -->|no| K{"Gemini key set?<br/>(Settings, else env)"}
    K -->|yes| GM["Gemini, 25 lines/batch,<br/>3 attempts, backoff 2 s·2ⁿ"]
    GM -->|ok, aligned| OK["captions replaced, timings kept"]
    GM -->|any failure| L
    K -->|no| L["M2M100 local (CTranslate2)<br/>a sentence at a time, beam 4"]
    L -->|ok| OK2["captions replaced<br/>(+ notice if Gemini failed)"]
    L -->|error| KEEP["keep spoken-language captions<br/>+ notice; job still completes"]
```

- A Gemini batch is rejected unless it returns a JSON array **of the same
  length**. A misaligned array would put the wrong text on each timing.
- M2M100 needs the source language. It uses Whisper's detected language and
  refuses codes missing from its vocabulary (`UnsupportedLanguage`). Every
  caption language is in its list (`M2M100_LANGUAGES`, held to
  `languages.LANGUAGES` by a test).
- **Sentences, not fragments** (v1.0.7). `sentence_groups` joins captions
  until one ends a sentence (`. ! ? … । ॥` and closing quotes), up to 4
  captions or 400 characters; the joined sentence is translated once and
  `split_like` splits it back over the same captions in proportion to their
  source lengths, at word boundaries, preferring a cut after punctuation
  within two words. Timings never move. A sentence with fewer translated
  words than captions is translated caption by caption instead.
- **Decode guards:** `max_decoding_length` = 3 × the longest source in tokens
  + 10, `no_repeat_ngram_size` 4, `repetition_penalty` 1.1. M2M100 can run
  away on languages it has seen little of (a remembered news paragraph in
  place of a caption).
- The M2M100 weights are third-party CTranslate2 conversions, **pinned to a
  commit** (`M2M100_MODELS`).
- `ModelDownloadError` propagates and fails the job with its message. Any
  other local failure returns `None`, and the job keeps the original captions.

## 7. Search and answers

- `embeddings.index_captions`:
  - encodes with `all-MiniLM-L6-v2`;
  - upserts IDs `"{video_id}:{caption_id}"` into the `captions` collection,
    with cosine space (`hnsw:space: cosine`).
- `search.search_vectors`:
  - **always filters by video IDs the caller owns**, resolved in Postgres;
    ChromaDB has no notion of owners;
  - drops hits with distance > 0.75.
- The encoder is loaded in the **API process** on its first search, in a
  thread (`asyncio.to_thread`).
- `rag.answer_question`:
  - **no hits:** returns the refusal without calling the model;
  - **no key:** returns the "add a key" sentence;
  - **otherwise:** Gemini with temperature 0.1 and up to 1500 output tokens.
    A reply containing the refusal sentence counts as ungrounded.
- Citations come from the hits the server retrieved, never from timestamps the
  model writes.

## 8. Startup recovery and retry limits

`backend/app/workers/recovery.py`, run at `worker_ready`:

1. **Take over unacked jobs.** With `acks_late`, a job delivered to a worker
   that died stays in Redis's `unacked` hash until a 1 h visibility timeout,
   then is redelivered outside any counter. At startup, every unacked
   `transcribe_video`/`render_export` is removed from the hash and handed to
   step 3. Other unacked messages are pushed back on their queue.
2. **Read the queue** (`celery` list) for jobs still waiting.
3. **Recover.** Every video or export that is `pending`/`processing` and
   **not** waiting in the queue:
   - if `recovery_attempts < 3` (`MAX_REQUEUES`): the counter goes up, it is
     **committed**, and only then is the task queued;
   - otherwise: it is marked `failed` with `VIDEO_GAVE_UP` / `EXPORT_GAVE_UP`
     ("…usually means the computer ran out of memory. Choose a smaller speech
     model…").
4. A manual retry (`POST /api/videos/{id}/transcribe` → `mark_queued`) resets
   `recovery_attempts` to 0.

Why it is safe: there is one worker node, and at startup it is working on
nothing, so anything `processing` is stranded. Redis runs with
`--save "" --appendonly no`, so a restart loses the queue. Recovery is what
brings those jobs back. Verified live: 3 OOM kills, then failed with the
smaller-model message (PROGRESS.md).

Other retry limits in the code:

| Where | Limit |
|---|---|
| Gemini translation batch | 3 attempts, backoff 2 s, 4 s |
| Gemini answer | 60 s timeout, no retry |
| Celery task | none (solo pool enforces none; see §4.3) |
| FFmpeg render | 3 h timeout |
| Probe / thumbnail / waveform | 30 s / 60 s / 300 s |
| Install health wait | 120 × 3 s |
| Frontend 401 | one silent refresh, then one replay (`lib/api.ts`) |
| "Can't reach the app yet" screen | retries every 3 s (`server-unavailable.tsx`) |

## 9. Dev vs production compose

| | `docker-compose.yml` (dev) | `docker-compose.prod.yml` (installed) |
|---|---|---|
| Project name | directory name (`videocaptionmaker`) | `vcm` (so `--remove-orphans` can never touch dev) |
| Images | built locally, `target: dev`; backend `VARIANT` defaults to **cpu**, `VCM_VARIANT=cuda` for the GPU | pulled from GHCR, `VCM_VERSION`-`VCM_VARIANT` (`cpu` unless the installer found a GPU) |
| Source | bind-mounted (`./backend:/app`, `./frontend:/app`) | baked into the image |
| Backend command | `uvicorn --reload`; **migrations are run by hand**: `docker compose exec backend alembic upgrade head` | entrypoint `api`: `alembic upgrade head`, then uvicorn `--no-proxy-headers` |
| Worker command | `watchfiles … celery … --pool=solo` (restarts on code change) | entrypoint `worker` |
| Frontend | `npm run dev`, `NEXT_PUBLIC_API_URL=http://localhost:8000` | standalone `node server.js`, same-origin `/api` proxy |
| Ports on 127.0.0.1 | 3000, 8000, 5432, 6379, 8100 | `${VCM_PORT:-3000}` only |
| Secrets | `.env` in the repo root (gitignored), dev defaults | `.env` generated by the installer |
| Redis | persisted volume `redis_data` | no persistence |
| Postgres | `postgres:16-alpine` | `postgres:16.14-alpine` (pinned) |
| Healthchecks | postgres, redis | every service |
| Fonts | `./frontend/public/fonts` bind-mounted read-only | copied into the image |
| Certs | `./backend/certs` | `./certs` next to the compose file |

**Both stacks default to port 3000.** Only one can hold it: run `vcm stop`
before `docker compose up` (PROGRESS.md).

**The CPU image is the default in both stacks, and the GPU is an override.**
For a GPU dev stack:
`VCM_VARIANT=cuda docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build`
(or `VCM_VARIANT=cuda` in the dev `.env`). CI checks the default with
`docker compose config`.

`docker-compose.gpu.yml` can be layered over either file. It reserves one
NVIDIA GPU for the worker and sets
`NVIDIA_DRIVER_CAPABILITIES=compute,utility,video`; `video` is required for
NVENC.

### Images and layer order

- **Backend** (`backend/Dockerfile`):
  - stage `deps` builds `/opt/venv` from `pyproject.toml` +
    `constraints.txt`, with CPU torch; the CUDA variant adds pinned
    `nvidia-cublas-cu12`/`nvidia-cudnn-cu12`;
  - stage `runtime` adds the apt packages (ffmpeg and fonts), copies the venv
    and the vendored fonts (`frontend/public/fonts`, a late layer, so a font
    change is a small update), then the app;
  - **the version `ARG`/`LABEL`/`ENV` are last**, so a new version only
    changes the image config.
- **Frontend:** `deps` → `build` (`npm run build`, standalone) → `runtime`
  (non-root user `app`). The version label is last here too.
- CI caches layers in GHCR (`buildcache*` tags), so unchanged layers keep
  their digests from release to release. See DECISIONS.md D7.

## 10. Failure scenarios

| Scenario | What happens | Where |
|---|---|---|
| Backend still starting when the browser opens | "Can't reach the app yet", auto-retry every 3 s | `server-unavailable.tsx` |
| API 5xx / proxy 502–504 | UI shows a sentence, never the raw body | `extractError` in `lib/api.ts` |
| Docker or the machine restarts mid-job | Containers restart (`unless-stopped`); recovery requeues (≤ 3) | §8 |
| Worker OOM-killed repeatedly by one job | Failed after 3 requeues with the smaller-model advice | `recovery.py` |
| GPU unusable at load | CPU int8 fallback + notice | `transcription.load_model` |
| Gemini down, quota, bad key | Local M2M100 + notice | `translation.translate_texts` |
| ChromaDB down during indexing | Job completes; search misses that video until a re-index | `transcription._run` |
| Redis down when queuing | Upload still 201 (retry from UI); retranscribe 503; render 503 and row removed | `api/videos.py`, `api/exports.py` |
| Redis down for rate limiting (accounts mode) | Fails open (request allowed) | `utils/rate_limit.py` |
| Disk full on upload | 507 with a sentence | `api/videos.py` |
| Disk full in worker | "The disk is full. Free some space…" | `friendly_error` |
| Model download blocked by TLS interception | Message pointing to `certs/` + `vcm restart` | `model_store.py` |
| Google font fetch fails | 502 for that font file | `api/fonts.py` |
| Source file missing | Stream/waveform 404; worker "The uploaded file is missing…"; render fails | various |
| Request from a non-local host or another origin (local mode) | 403 + `audit.log` line | `request_guard.py` |
| A caller other than the frontend sends `X-Forwarded-For` | Ignored; its own address is recorded | `proxy_headers.py` |
| A video is deleted | Row, source, thumbnail, waveform, vectors **and export files** removed | `services/video.delete_video` |
| Downloaded install file altered | Install or update aborts; nothing replaced | `install.sh`, `vcm`, `.ps1` |

## 11. Dependency rules

These are the rules the code follows today. Keep them:

1. **Layering (backend):** `api → services → models`. `workers → services →
   models`. `utils` and `config` are leaves.
   - No module in `services/`, `models/`, `workers/` or `utils/` imports
     `app.api`.
   - `models/` never imports `services/`.
2. **The API process must not import the worker or the ML stack at module
   level.** Routes import tasks inside the function that queues them (for
   example `_enqueue_transcription` in `api/videos.py`). The exceptions:
   - `services/search.py` and `services/embeddings.py` load
     sentence-transformers/Chroma for search, lazily on first use.
3. **Routers stay thin.** They check ownership (always **404, never 403**, for
   someone else's resource), validate, call a service, and map to a schema.
   Logic belongs in `services/`.
4. **One source of truth per list**, served to the client rather than copied
   into it:
   - languages: `services/languages.py` → `/api/videos/languages`;
   - fonts and presets: `services/caption_style.py` → `/api/styles/options`;
   - speech model choices: `hardware.WHISPER_CHOICES` → `/api/system`;
   - export resolutions: `rendering.available_heights` →
     `/exports/options`.
5. **Frontend:**
   - Components call hooks (`src/hooks/*`).
   - Hooks call `api` (`src/lib/api.ts`).
   - Nothing calls `fetch` directly for the JSON API. The exceptions are:
     - the upload, which uses XHR so it can report progress (`lib/upload.ts`);
     - thumbnails, which need the bearer header on an image
       (`components/videos/authed-image.tsx`);
     - downloads, which are a tokenised link (`lib/download.ts`).
6. **Settings** come only from `app/config.py` (`get_settings()`). There are
   no `os.environ` reads elsewhere in `app/`. Runtime-changeable settings live
   in `app_settings` (`services/app_settings.py`).
7. **Pinned versions:**
   - Python packages through `backend/constraints.txt`; CUDA libraries in the
     Dockerfile/extra;
   - base images in `docker-compose.prod.yml` and the Dockerfiles;
   - M2M100 by commit.
   - Change a pin only after verifying it on the hardware listed in
     PROGRESS.md ("Pinned GPU stack").

## Decisions recorded

Answers from the maintainer (2026-10-14) to this document's former open
questions:

| Question | Answer |
|---|---|
| Celery's 35 min hard limit vs long jobs | Fixed in v1.0.5: no Celery limit (§4.3). |
| Dev compose defaulted to the CUDA build | Fixed in v1.0.5: CPU by default, GPU as an override (§9). |
| Dev migrations are manual | Acceptable; the command is in §9 and [TESTING.md](TESTING.md). |
| Deleting a video left its export files | Fixed in v1.0.5. |
