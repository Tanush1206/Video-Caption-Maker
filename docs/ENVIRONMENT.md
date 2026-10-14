# Environment variables

Every environment variable the project reads or sets, grouped by who sets it.
Values shown are **defaults from the code or config files**, never the
contents of anyone's `.env`.

**Rules:**
- **Never** commit a `.env`, and never read, print or log the values in one.
  Refer to variables by name.
- In the backend, a variable is read **only** through `backend/app/config.py`
  (pydantic-settings; names are case-insensitive, so `WHISPER_MODEL_SIZE`
  sets `whisper_model_size`). Nothing in `backend/app/` calls `os.environ`.
- A setting the user should be able to change at runtime belongs in
  `app_settings` (Settings page), not in an env var. Today those are the
  Gemini key and the speech model.

"Secret" means the value must never appear in git, an image, a release, a log
or an API response.

## 1. Installer and `vcm` (host shell, optional)

Read by `install/install.sh`, `install/install.ps1`, `install/vcm` and
`install/vcm.ps1` when you run them.

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `VCM_HOME` | install folder | `~/.videocaptionmaker` (macOS/Linux), `%LOCALAPPDATA%\VideoCaptionMaker` (Windows) | no |
| `VCM_PORT` | UI port, written to `.env` | the value already in `.env`; otherwise 3000, or the first free one of 3001–3005, 3080, 8080 | no |
| `VCM_GPU` | `1` forces the CUDA variant, `0` forces CPU | detect (nvidia-smi + `docker run --gpus all busybox:1.37`) | no |
| `VCM_VERSION` | image tag, written to `.env` | the value in `.env`, else `latest` | no |
| `VCM_REGISTRY` | image registry, written to `.env` if set | `ghcr.io/tanush1206` | no |
| `VCM_BASE_URL` | where release assets are fetched from (tests point it at a local server) | `https://github.com/Tanush1206/Video-Caption-Maker/releases/latest/download` | no |
| `VCM_NO_OPEN` | `1` = don't open the browser after install | `0` | no |

## 2. The install's `.env` (generated)

Written by the installer next to `docker-compose.prod.yml` and read by
`docker compose --env-file .env`. On macOS/Linux it is mode `600`.

| Variable | Purpose | Set by | Secret |
|---|---|---|---|
| `POSTGRES_PASSWORD` | database password; also embedded in the backend's `DATABASE_URL` | installer, first run: 64 hex chars from 32 random bytes | **yes** |
| `JWT_SECRET_KEY` | signs access, refresh, stream and download tokens | installer, first run: same generation | **yes** |
| `VCM_PORT` | host port for the UI (`127.0.0.1:${VCM_PORT}:3000`) | installer | no |
| `VCM_VARIANT` | `cpu` or `cuda`: image suffix, and whether `vcm` adds `docker-compose.gpu.yml` | installer | no |
| `VCM_VERSION` | image tag (`latest` → `latest-cpu`/`latest-cuda`) | installer | no |
| `VCM_REGISTRY` | only if overridden | installer | no |
| `WHISPER_MODEL_SIZE` | optional; passed to the backend and worker (see §3) | the user, by hand | no |
| `MAX_UPLOAD_SIZE_MB` | optional; prod compose default **4096** | the user, by hand | no |

`docker-compose.prod.yml` refuses to start without `POSTGRES_PASSWORD` and
`JWT_SECRET_KEY`: `${…:?run the installer to generate .env}`.

**The production compose passes only these to the backend and worker:**
`ENVIRONMENT=production`, `AUTH_MODE=local`, `DATABASE_URL`, `REDIS_URL`,
`CHROMADB_URL`, `JWT_SECRET_KEY`, `WHISPER_MODEL_SIZE`, `MAX_UPLOAD_SIZE_MB`.
Every other backend setting in an install is the code default. In particular,
**`GEMINI_API_KEY` in the install's `.env` has no effect**: on an install the
key is set in Settings.

## 3. Backend settings (`backend/app/config.py`)

Read by both the API and the worker. Dev: from the repo-root `.env`
(`env_file: .env` in `docker-compose.yml`, plus a `.env` in the working
directory). Prod: only what §2 lists.

### App

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `ENVIRONMENT` | `production` turns off SQL echo and sets the cookie `Secure` flag | `development` (prod compose: `production`) | no |
| `CORS_ORIGINS` | comma-separated origins for CORS, and for the request guard's **direct** (non-proxied) calls | `http://localhost:3000` | no |
| `AUTH_MODE` | `local` = one user, no login, request guard on; `accounts` = registration/JWT/Google | `local` | no |
| `MAX_UPLOAD_SIZE_MB` | upload cap, enforced while streaming | `2048` (prod compose: `4096`) | no |

### Connections

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `DATABASE_URL` | SQLAlchemy async URL | `postgresql+asyncpg://vcm:vcm_dev_password@postgres:5432/vcm` (dev default). Compose builds it from `POSTGRES_*` | **yes** (contains the password) |
| `REDIS_URL` | Celery broker and backend, rate limits, denylist | `redis://redis:6379/0` | no |
| `CHROMADB_URL` | vector store (`http://host:port`) | `http://chromadb:8000` | no |

### Auth and tokens

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `JWT_SECRET_KEY` | HMAC key for every token | `dev-only-insecure-secret-change-me` (**must** be overridden; the installer does) | **yes** |
| `JWT_ALGORITHM` | | `HS256` | no |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | | `30` | no |
| `REFRESH_TOKEN_EXPIRE_DAYS` | | `7` | no |
| `STREAM_TOKEN_EXPIRE_MINUTES` | media URL token | `60` | no |
| `DOWNLOAD_TOKEN_EXPIRE_MINUTES` | export download token | `15` | no |
| `REFRESH_COOKIE_NAME` | | `vcm_refresh` | no |
| `AUTH_RATE_LIMIT_ATTEMPTS` | per bucket | `10` | no |
| `AUTH_RATE_LIMIT_WINDOW_SECONDS` | | `300` | no |
| `GOOGLE_OAUTH_CLIENT_ID` | accounts mode | empty | no |
| `GOOGLE_OAUTH_CLIENT_SECRET` | accounts mode | empty | **yes** |
| `GOOGLE_OAUTH_REDIRECT_URI` | must match the Google console exactly | `http://localhost:8000/api/auth/google/callback` | no |
| `FRONTEND_URL` | where OAuth sends the browser back | `http://localhost:3000` | no |

### Gemini (optional)

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `GEMINI_API_KEY` | fallback key when none is set in Settings (Settings wins) | empty | **yes** |
| `GEMINI_MODEL` | model alias for translation and answers | `gemini-flash-latest` | no |

### Speech (Whisper)

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `WHISPER_MODEL_SIZE` | `auto`, or a model name. Overrides the hardware tier; Settings overrides this | `auto` | no |
| `WHISPER_DEVICE` | `auto`, `cuda` or `cpu` (`cuda` without CUDA falls back to `cpu`) | `auto` | no |
| `WHISPER_COMPUTE_TYPE` | `auto` or a CTranslate2 type (`float16` on CPU is replaced with `int8`) | `auto` | no |
| `WHISPER_VAD_FILTER` | Silero VAD (off: silence is detected with FFmpeg `silencedetect` instead) | `false` | no |
| `WHISPER_VAD_THRESHOLD` | used only when VAD is on | `0.1` | no |
| `WHISPER_VAD_SPEECH_PAD_MS` | | `400` | no |
| `WHISPER_VAD_MIN_SILENCE_MS` | | `1000` | no |
| `WHISPER_LANGUAGE` | | unset (detect) | no |

### Translation, search, storage

| Variable | Purpose | Default | Secret |
|---|---|---|---|
| `TRANSLATION_MODEL` | `auto` (1.2B if RAM ≥ 12 GB, else 418M), `m2m100_1.2B` or `m2m100_418M` | `auto` | no |
| `EMBEDDING_MODEL` | sentence-transformers model for search | `sentence-transformers/all-MiniLM-L6-v2` | no |
| `CHROMA_COLLECTION` | | `captions` | no |
| `STORAGE_LOCAL_PATH` | storage root (uploads, exports, `audit.log`) | `/app/storage` | no |
| `FONT_CACHE_DIR` | Google Fonts download cache | `/usr/share/fonts/truetype/vcm-cache` | no |
| `STORAGE_BACKEND` | declared, **not read by any code** | `local` | no |
| `MODEL_CACHE_DIR` | declared, **not read by any code** (`HF_HOME` decides) | `/root/.cache/huggingface` | no |

## 4. Set inside the images

### Backend image (`backend/Dockerfile`, `runtime` stage)

| Variable | Value | Why |
|---|---|---|
| `VCM_VERSION` | build arg `VERSION` (`dev` locally; the tag without `v` in CI) | identifies the build. Set **last** in the Dockerfile so it doesn't invalidate layers. No code reads it |
| `VCM_VARIANT` | `cpu` or `cuda` | identifies the variant; no code reads it |
| `HF_HOME` | `/root/.cache/huggingface` | the models volume |
| `HF_HUB_DISABLE_XET` | `1` | plain HTTP downloads: visible progress, resumable |
| `HF_HUB_DISABLE_IMPLICIT_TOKEN` | `1` | no token sent |
| `SSL_CERT_FILE`, `REQUESTS_CA_BUNDLE` | `/etc/ssl/certs/ca-certificates.crt` | one trust store for every client, including extra CAs from `certs/` |
| `LD_LIBRARY_PATH` | pip's `nvidia/cublas/lib` and `nvidia/cudnn/lib` | CTranslate2 finds CUDA libraries by soname |
| `TOKENIZERS_PARALLELISM` | `false` | |
| `PYTHONUNBUFFERED`, `PYTHONDONTWRITEBYTECODE` | `1` | |
| `PIP_DISABLE_PIP_VERSION_CHECK`, `PIP_NO_CACHE_DIR` | `1` | `deps` stage only |

### Frontend image (`frontend/Dockerfile`)

| Variable | Stage | Value | Why |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | build | `""` | the browser calls `/api` on its own origin. Inlined at build time |
| `NEXT_PUBLIC_AUTH_MODE` | build (arg) | `local` | anything but `accounts` = local mode (`frontend/src/lib/config.ts`). A hosted build passes `--build-arg NEXT_PUBLIC_AUTH_MODE=accounts` |
| `BACKEND_URL` | build | `http://backend:8000` | target of the `/api/*` rewrite. **Compiled into the routes manifest at build time** (`next.config.js`) |
| `NEXT_TELEMETRY_DISABLED` | all | `1` | |
| `NODE_ENV`, `PORT`, `HOSTNAME` | runtime | `production`, `3000`, `0.0.0.0` | standalone server |
| `NODE_EXTRA_CA_CERTS` | build steps only | the `extra_ca` BuildKit secret, if given | never set in the runtime image |

## 5. Compose-only

| Variable | File | Purpose |
|---|---|---|
| `POSTGRES_USER`, `POSTGRES_DB` | dev compose (`${…:-vcm}`) | dev database user and name. Prod hardcodes `vcm`/`vcm` |
| `POSTGRES_PASSWORD` | both | dev default `vcm_dev_password`; prod required from `.env` |
| `VCM_VARIANT` | dev compose | backend build arg, default **`cuda`** |
| `WATCHFILES_FORCE_POLLING` | dev compose (backend) | `uvicorn --reload` on Windows bind mounts |
| `WATCHPACK_POLLING` | dev compose (frontend) | Next dev file watching on Windows bind mounts |
| `NVIDIA_DRIVER_CAPABILITIES` | `docker-compose.gpu.yml`, dev worker | `compute,utility,video`. **`video` is required for NVENC** |

## 6. CI (`.github/workflows/release.yml`)

| Name | Purpose | Secret |
|---|---|---|
| `GITHUB_TOKEN` | log in to GHCR and create the Release (`packages: write`, `contents: write`) | **yes** (provided by Actions) |
| `REGISTRY` | `ghcr.io/tanush1206` | no |
| build args `VARIANT`, `VERSION` | from the matrix and the tag | no |

## 7. `.env.example` (development template)

`cp .env.example .env` creates the dev settings. It lists the database,
Redis, Chroma, auth, Gemini, Whisper and storage variables above, all with
placeholder or default values. It also lists **`S3_BUCKET`, `S3_REGION`,
`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`, which no code reads.**

## Open questions

1. **Unused variables.** `STORAGE_BACKEND`, `MODEL_CACHE_DIR` and the four
   `S3_*` entries are declared but never read. Should they be removed from
   `config.py` and `.env.example`, or is S3 storage planned?
2. **`.env.example` suggests a different secret format.** It suggests
   `secrets.token_urlsafe(64)` for `JWT_SECRET_KEY`, while the installer
   generates 64 hex characters. Both work; should the docs recommend one?
3. **The upload limit has two defaults:** 2048 MB in `config.py` and 4096 MB
   in the production compose. The README and the Next proxy comment mention
   2 GB. Which is the intended product limit?
4. **`GEMINI_API_KEY` in an install's `.env` is silently ignored,** because
   the production compose doesn't pass it through. Is that intended, with
   Settings as the only supported way to set a key on an install?
