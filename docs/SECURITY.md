# Security

The security design of VideoCaptionMaker as of v1.0.5 (on `main`): a single-user
app that runs on the user's own computer. Every rule names the file that
enforces it.

## 1. Threat model

### What is protected

| Asset | Where |
|---|---|
| The user's videos, captions and exports | `media` volume, Postgres |
| The Gemini API key (if set) | `app_settings.gemini_api_key` in Postgres |
| The install's secrets (`POSTGRES_PASSWORD`, `JWT_SECRET_KEY`) | the install's `.env` |
| The integrity of what gets installed and updated | release assets, GHCR images |

### Trust boundaries

- **The network.** Nothing is published except the UI, and that only on
  **`127.0.0.1:${VCM_PORT}`** (`docker-compose.prod.yml`). Postgres, Redis,
  ChromaDB and the API are reachable only on the compose network. Other
  machines on the LAN cannot connect.
- **The person at the computer** is the only user, and is trusted. Local mode
  has no login (`AUTH_MODE=local`, `backend/app/dependencies.py`).
- **Other web pages in the user's browser are not trusted.** They can make the
  browser send requests to `localhost`. This is the main threat the request
  guard addresses (§3).
- **Other local programs are trusted, in effect.** A program running as the
  user can call the API without browser headers and is allowed through. It
  could forge any header anyway. This is a deliberate limit, not a gap the
  guard tries to close.

### In scope
- Cross-site requests, DNS rebinding, and other localhost apps acting through
  the browser.
- Path traversal and file-type abuse through uploads and download names.
- Header injection through user-chosen download names.
- Secrets leaking into git, images, releases, logs or API responses.
- Tampered or truncated installer files.
- TLS-intercepting proxies or antivirus breaking downloads (handled by
  trusting a user-supplied CA, never by disabling verification).

### Out of scope (by design)
- An attacker with the user's OS account, or with Docker access on the host.
- Other users on the LAN; they are blocked by binding to 127.0.0.1, not by
  auth.
- A compromised GitHub account or GHCR. See the limits in §8.

## 2. Authentication modes

| | Local mode (installed app) | Accounts mode (hosted build, not shipped) |
|---|---|---|
| Who | one auto-created user (`local-user@localhost.localdomain`) | registered users, or Google sign-in |
| Login UI | none; `/`, `/login`, `/register` redirect to `/dashboard` (`frontend/src/middleware.ts`) | login and register pages |
| API credential | none needed; every request acts as the local user | `Authorization: Bearer` access token (30 min) |
| Request guard | **on** | off |
| Install settings (`PATCH /api/system/settings`) | allowed | 403 |

What accounts mode implements (kept in the code, covered by tests):

- **Passwords** are hashed with **bcrypt directly**, not passlib:
  passlib 1.7.4 breaks with bcrypt ≥ 5. Passwords over 72 bytes are rejected,
  not silently truncated (`backend/app/utils/security.py`).
- **Tokens:**
  - JWT access token (30 min) and refresh token (7 days, httpOnly cookie
    `vcm_refresh`, `SameSite=Lax`, path `/api/auth`, `Secure` in
    production).
  - Each token has a `type` claim, so a refresh token can't be used as an
    access token, and a `jti` for revocation.
  - Logout revokes the refresh token in a Redis denylist that fails closed.
  - A password change moves `users.sessions_valid_from`, which kills every
    older refresh token.
- **Login** gives the same response, and spends about the same time (a dummy
  bcrypt comparison), for a wrong password and for an unknown email.
- **Rate limits** allow 10 attempts per 300 s in each bucket:
  - register: per IP;
  - login: per IP **and** per email (both buckets reset on success);
  - password change and account deletion: per user.

  They are Redis-backed and **fail open** (`backend/app/utils/rate_limit.py`).
- **Google OAuth** is implemented with `httpx`, with the CSRF state kept in
  Redis.
- **The frontend** keeps the access token in memory only (Zustand,
  `frontend/src/stores/auth.ts`), never in localStorage.

**In both modes:**
- Media and download URLs carry short-lived, single-resource tokens:
  - a **stream** token (60 min, claim `vid`) bound to one video;
  - a **download** token (15 min, claim `eid`) bound to one export.
- Each type is refused anywhere else, including as an API credential.
- A resource someone else owns returns **404, never 403**.

## 3. The request guard

`backend/app/request_guard.py`, registered as HTTP middleware in
`backend/app/main.py`. It is **active only in local mode**.

### Why it exists

Local mode has no login, and listening on 127.0.0.1 is not on its own a
boundary, because **any page the user has open can make the browser send
requests to localhost**:

- **DNS rebinding.** A domain the attacker controls resolves to `127.0.0.1`.
  Its page is then *same-origin* with the install, so CORS never applies, and
  it could read and delete everything. The `Host` it sends is its own domain,
  not `localhost`.
- **Cross-site and same-site requests.** A page on any other origin,
  including another app on a different localhost port, can send
  state-changing requests. The browser labels them in `Sec-Fetch-Site`.

On 2026-10-11, six videos on a running install were deleted through the
frontend proxy by an actor nobody could identify afterwards. The access log
had no User-Agent or Origin, and the container that held it had been
replaced (PROGRESS.md, R11). The guard and `audit.log` are the fix
(`491ebee`, `72ea1fa`).

### Why CORS was not enough

- **CORS controls whether a page may read a response. It does not stop the
  browser from sending the request.** A cross-site form POST or a no-cors
  fetch still reaches the server.
- **DNS rebinding makes the attacker same-origin**, so CORS is never
  consulted.
- **Through the Next proxy, every request reaches the API from the
  frontend.** The browser sees one origin, so CORS cannot tell the app's own
  pages from anything else.
- **The production compose never sets `CORS_ORIGINS`.** Its default,
  `http://localhost:3000`, was trusted on every install, including one moved
  to port 3001. That was the guard hole fixed before v1.0.3: the allowed
  origin is now the install's own forwarded host and port (`72ea1fa`).

### The rules, in order (`refusal_reason`)

1. **Host.** Take `X-Forwarded-Host` (set by the Next proxy), or else `Host`.
   Its hostname **must** be one of `localhost`, `127.0.0.1`, `::1` or
   `backend`. Otherwise the request is refused: "host … is not this
   computer". This applies to **every method, reads included**, which is what
   defeats DNS rebinding.
2. **Safe methods** (`GET`, `HEAD`, `OPTIONS`) pass once rule 1 holds.
3. **`Sec-Fetch-Site: cross-site`** on a state-changing method is refused.
4. **No `Origin` header** (a script or CLI, not a browser) passes.
5. **Through the proxy** (`X-Forwarded-Host` present): `Origin`'s `host:port`
   **must equal** the forwarded host exactly. That is whatever port the
   install was given, at `localhost` or `127.0.0.1`. Another app's port,
   `null`, or any other origin is refused.
6. **Direct to the backend** (dev only; the install doesn't expose it):
   `Origin` must be listed in `CORS_ORIGINS`.

A refusal returns `403` with
`{"detail": "This request didn't come from VideoCaptionMaker on this computer, so it was refused."}`
and is written to the audit log with the reason.

Verified live on both installs at `localhost` and `127.0.0.1`:
- another port's Origin → 403;
- cross-site → 403;
- a rebinding Host → 403;
- the app's own origin passes.

The tests are in `backend/tests/test_request_guard.py` (8 tests; 6 fail with
the guard removed).

## 3a. Security headers and the frontend's own guard (v1.1.1)

The API's guard (§3) only sees requests that reach the API. Two things now
stand in front of the pages too (docs/LAUNCH_AUDIT.md S1, S4).

**Headers on every response** (`frontend/next.config.js`, `headers()`):

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'`; scripts `'self' 'unsafe-inline'`; styles `'self' 'unsafe-inline'`; images `'self' blob: data:`; media `'self' blob:`; fonts `'self' data:`; `connect-src 'self'`; `object-src 'none'`; `base-uri 'none'`; `form-action 'self'`; **`frame-ancestors 'none'`** | Nothing loads from anywhere else. Framed by another site, the app's own clicks would be same-origin and pass §3, so a hidden page could click Delete for you (clickjacking, shown in the audit); no site may frame it. Inline scripts are Next's App Router bootstrap (no nonces). Development adds the API's port, `'unsafe-eval'` and `ws:` |
| `X-Frame-Options` | `DENY` | the same, for browsers that predate `frame-ancestors` |
| `X-Content-Type-Options` | `nosniff` | also set by the API on every response (`no_sniffing` in `backend/app/main.py`), so a user's file is never sniffed into something a browser runs |
| `Referrer-Policy` | `same-origin` | **not `no-referrer`**: under that, browsers send `Origin: null` with the app's own POST/PATCH/DELETE, which §3 refuses |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | nothing here uses them |

**The frontend guard** (`frontend/src/middleware.ts`, local mode only):
- the `Host` must be `localhost`, `127.0.0.1` or `[::1]` (DNS rebinding);
- a request with `Sec-Fetch-Site` other than `same-origin` or `none` is
  refused unless it is a top-level `GET` navigation: another site may link to
  the app, but may not fetch pages, server-component payloads or post forms;
- requests without browser headers (scripts, `vcm`, the health check) pass;
- `/_next/image` answers 404, and `images.unoptimized` removes the optimiser
  the app never used (Next 14's image-optimiser advisories);
- **one path is left out: `/api/videos`**, the upload (and the list), the
  only route with a large body (v1.2.0). Next copies the body of any request
  middleware runs on and keeps only its first 10 MB, which cut every larger
  upload off. There the API's guard (§3) does the same job: other origins,
  other localhost ports, a rebinding Host, and a forged `X-Forwarded-Host`
  with an Origin to match are all refused (403), through the proxy
  (`scripts/ui-check` `upload-proxy`). Its Host comes from
  `X-Forwarded-Host`, which `forwarded-for.js` sets from the request (§4a).

Refusals are 403 with the same sentence as §3. Checked by
`frontend/tests/security-headers.test.js` and, in a real browser, by
`scripts/ui-check` `framing`, `frontend-guard` and `csp`.

## 4. `audit.log`

Written by `audit()` in `backend/app/request_guard.py`.

| | |
|---|---|
| **Where** | `<storage root>/audit.log`, i.e. `/app/storage/audit.log` on the `media` volume. It survives updates and container replacement. |
| **What is recorded** | every **refused** request (403); every **DELETE** (any status); every **POST/PUT/PATCH to `/api/system/settings`** |
| **Fields** (one JSON object per line) | `time` (UTC), `method`, `path`, `status`, `user_agent`, `origin`, `referer`, `sec_fetch_site`, `host` (forwarded or direct), `client` (through the frontend: the address of whatever connected to the frontend, which in a Docker install is usually Docker's gateway rather than the browser; otherwise the API's own peer. Never a caller-supplied value; see §4a), and `refused` (the reason) on refusals |
| **Never recorded** | **request bodies**. A settings body can hold the Gemini key. Tested by `test_a_settings_change_is_recorded_without_its_value`. Query strings aren't recorded either; only `path` is. |
| **Rotation** | before a write, if `audit.log` is over **5 MB** it is renamed to `audit.log.1`, replacing the previous `.1`. At most two files of about 5 MB each (`AUDIT_MAX_BYTES`; `test_the_audit_log_cannot_grow_without_bound`). |
| **Also** | each entry is logged through Python logging (`logger.info("audit …")`), so it appears in `vcm logs backend` too. A failed write is logged and never fails the request. |
| **Accounts mode** | no auditing; the guard is off |

To read it on an install:
`docker exec vcm-backend-1 cat /app/storage/audit.log`.

### 4a. Forwarded headers

Until v1.0.5 uvicorn ran with `--forwarded-allow-ips='*'`, so any caller that
could reach the API could put any address into `X-Forwarded-For`, and with it
into `audit.log`. Now:

- uvicorn runs with `--no-proxy-headers` (`backend/docker-entrypoint.sh`);
- the `TrustedProxyHeaders` middleware (`backend/app/proxy_headers.py`)
  applies `X-Forwarded-For`/`-Proto` **only** when the peer's address is one
  that `TRUSTED_PROXIES` (default `frontend`, the compose service name)
  resolves to;
- it re-resolves at most every 5 s, so a recreated frontend is recognised and
  its old address stops being trusted;
- if the name doesn't resolve, nobody is trusted.

A service name was needed because uvicorn only trusts IPs or networks, and
the frontend's IP is assigned at start (after the API's). Verified live on the
dev network: a container aliased `frontend` had its forwarded address
recorded, while another container sending the same header had its own
address recorded. Tests: `backend/tests/test_proxy_headers.py`.

**What the frontend forwards** (since `forwarded-for.js`, after v1.0.5).
Trusting the frontend is only safe if the frontend never passes a caller's
value along. Next's `/api` rewrite proxy does: it forwards the incoming
headers as they are and adds `X-Forwarded-For` only when it is missing. In
v1.0.5, anyone who could reach the UI port could therefore write any address
into `audit.log`; this was found during the v1.0.5 release check.

Now `frontend/forwarded-for.js` is preloaded into the Next server
(`node -r` in the runtime image, `NODE_OPTIONS` in the dev compose). On every
request and upgrade, before Next sees it, it **overwrites**:
- `X-Forwarded-For` with the frontend socket's peer address;
- `X-Forwarded-Proto` with `https` or `http`, from whether that socket is TLS;
- `X-Forwarded-Host` with the request's own `Host` (v1.2.0).

Whatever the caller sent is dropped. Next 15's rewrite proxy also sets
`X-Forwarded-Host` from `Host`, but `/api/videos` doesn't go through that
proxy (§3a, ARCHITECTURE.md §2), and there the API guard's Host check is the
only one: the preload makes it unforgeable whatever Next does. A rebinding
page is same-origin with its own name, so it can send any header with an
Origin to match; it still reaches the API as its real Host
(`forwarded-for.test.js`, and `upload-proxy` through the built image).

**Who the peer is.** It is whatever opened the TCP connection to the
frontend, which is not always the browser:
- **a browser on the same computer** (every normal use of an install): the
  connection arrives through Docker's port publishing, so the peer is
  **Docker's gateway on the compose network** (e.g. `172.20.0.1`), not
  `127.0.0.1`. Every browser request records the same gateway address;
- **another container on the compose network**: that container's own
  address.

So `client` tells the gateway (outside Docker) apart from containers on the
network, and can't be forged; it can't tell two programs on the host apart.

Verified on the built runtime image behind `-p 127.0.0.1:…:3000` with a
header-echo backend:
- from the host, a request sending `X-Forwarded-For: 203.0.113.9` and
  `X-Forwarded-Proto: https` reached the backend as `172.20.0.1` (the
  network's gateway) and `http`;
- from a container, it reached the backend as that container's address.

Tests: `frontend/tests/forwarded-for.test.js` (`npm test`, run in CI). They
send a forged header directly, send no header, and go through Next's own
rewrite proxy (`proxyRequest`). All three fail without the preload.

The request guard's `X-Forwarded-Host` rule (§3) is unchanged: only the
frontend can reach the API in an install, and a direct caller is a script,
which the guard already lets through.

## 5. Secrets

| Secret | Created by | Stored | Rules |
|---|---|---|---|
| `POSTGRES_PASSWORD` | installer, first run | install `.env` | 64 hex chars from 32 random bytes (`openssl rand -hex 32` or `/dev/urandom`; `RandomNumberGenerator` on Windows). Never contains `$`. Kept on reinstall. |
| `JWT_SECRET_KEY` | installer, first run | install `.env` | same generation. Signs stream and download tokens even in local mode |
| Gemini API key | the user, **in Settings only** (an install's `.env` doesn't pass it on) | Postgres `app_settings`, **plain text**: accepted for a local single-user app, since Postgres is reachable only on the compose network | write-only through the API: no response returns it, only `gemini_configured` and `gemini_source`. **Never logged**: `app_settings.py` logs no values, the audit log has no bodies, and both database engines use `hide_parameters=True`. Until v1.0.5 the dev SQL echo printed the key when it was saved. Tested by `test_the_gemini_key_is_never_logged_or_returned_anywhere`. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | operator (accounts mode only) | env | not used by the installed app |

**Rules:**

- **The install's `.env`:**
  - is created with `umask 077` and `chmod 600` on macOS/Linux
    (`install/install.sh`);
  - on Windows it lives under `%LOCALAPPDATA%\VideoCaptionMaker`. The
    installer sets no ACL of its own, and that is accepted: the folder is in
    the per-user profile and inherits its user-only permissions;
  - is **never** overwritten on reinstall. Uninstall keeps it unless the user
    typed `DELETE`, because the kept data is locked with its password.
- **The repository:**
  - `.env`, `certs/`, `backend/storage/`, `*.dump`, `design/stitch/` and
    `learning-guide.md` are gitignored;
  - no `.env`, key, certificate, dump or storage file is tracked, or ever has
    been (checked against full history for v1.0.4; PROGRESS.md "Secrets
    (final)").
- **The images:**
  - the backend is built from an **allow-list**
    (`backend/Dockerfile.dockerignore`: only `pyproject.toml`,
    `constraints.txt`, `alembic*`, `app/`, the entrypoint, the tests and
    `frontend/public/fonts`);
  - the frontend's `.dockerignore` excludes `.env*` (except `.env.example`)
    and `**/certs`;
  - checked on the 1.0.4 images: no `.env` or key files (the frontend's one
    `.pem` is Alpine's public CA bundle), an empty extra-CA directory, and
    `NODE_EXTRA_CA_CERTS` unset.
- **Build-time CA:**
  - a TLS-intercepting proxy's root is passed as a **BuildKit secret**
    (`--secret id=extra_ca,src=…`);
  - it is mounted only for the `RUN` that needs it and never written to a
    layer;
  - CI builds without one.
- **No root in the containers** (v1.1.1, §5a below).
- **Release assets** are exactly: `install.sh`, `install.ps1`, `vcm`,
  `vcm.ps1`, `vcm.cmd`, `docker-compose.prod.yml`, `docker-compose.gpu.yml`
  and `SHA256SUMS`.
- **Never** read, print or log the values in a `.env`. Tools and docs refer to
  variables by name only.

### 5a. Containers run without root (v1.1.1)

- **backend and worker** run as `vcm` (uid 10001). `docker-entrypoint.sh`
  starts as root only to trust extra CAs (`update-ca-certificates`) and to
  hand the `media`, `models` and `fonts` volumes to `vcm` (versions up to
  1.1.0 wrote them as root; every start re-owns anything that isn't
  `vcm`'s), then runs everything through `setpriv` as `vcm`.
- **The prod compose** sets `no-new-privileges` and `cap_drop: [ALL]`, adding
  back only `CHOWN DAC_OVERRIDE FOWNER SETUID SETGID` for that root step; the
  running processes have no effective capabilities (checked on an upgraded
  install: `CapEff 0`, `NoNewPrivs 1`). The frontend runs as `app` with no
  capabilities at all.
- **Upgrade from 1.1.0, tested** on a throwaway install with videos, an
  export, models and a downloaded font, all root-owned: after the update every
  file belonged to `vcm`, the old video streamed and its export downloaded,
  no model was downloaded again, and a new GPU transcription, a new font and
  an NVENC export all worked.

## 6. What goes over the network

With no Gemini key, after the models are downloaded, the core flow (upload,
transcribe, translate, export, search) makes **no outbound requests**.

| Destination | When | What is sent | Code |
|---|---|---|---|
| `github.com` (release assets) | install, `vcm update` | nothing about the user | `install/*`, `vcm` |
| `ghcr.io` | install, `vcm update` (image pulls) | nothing about the user | compose |
| Docker Hub | install, `vcm update` (the `postgres`, `redis` and `chromadb` images; the installer's `busybox` GPU check) | nothing about the user | compose, `install/*` |
| `huggingface.co` | first use of each model (Whisper size, M2M100 size, MiniLM; v1.0.9: the Hinglish speech model and IndicXlit). Never again once a model is cached: until v1.1.1 MiniLM was loaded by name, which asked Hugging Face for its newest files at every start; it is now loaded from the local snapshot (pinned commit, or an older version's copy) | model repo requests | `services/model_store.py`, `transcription.py`, `translation.py`, `embeddings.py`, `hinglish.py` |
| `raw.githubusercontent.com/google/fonts/<commit>/` | the first time a Google Font from the library is used | the font path, at the commit pinned in `app/data/google_fonts.json` | `services/font_library.py` |
| Gemini API (`google-genai`) | **only with a key**: translating to hi/fr/de/nl, and `POST /api/ask` | **caption text only**: up to 25 lines per translation batch, up to 6 retrieved captions plus the question for answers. **Never the video or audio.** | `services/translation.py`, `services/rag.py` |
| Google OAuth | accounts mode only | OAuth exchange | `api/auth.py` |

- `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`: no Hugging Face token is ever sent.
- **The Hinglish models are pinned and checked** (v1.0.9,
  `services/hinglish.py`). Each comes from its original repo at a fixed
  commit (`Oriserve/Whisper-Hindi2Hinglish-Apex`, Apache-2.0;
  `ai4bharat/IndicXlit`, MIT), and its weights are hashed after download and
  compared with the sha256 Hugging Face publishes for that commit; a
  mismatch deletes the download and fails the job. They are converted on the
  machine, never fetched pre-converted from anywhere else, and never built
  into an image. IndicXlit's checkpoint is a pickle: it is read with
  `torch.load(weights_only=True)`, allowing only `argparse.Namespace`, and
  only after its hash has matched.
- Font files are served by the backend itself, never by redirecting the
  browser to Google, so the user's IP isn't shared with a third party while
  they browse fonts (`api/fonts.py`).
- `NEXT_TELEMETRY_DISABLED=1` is set in the frontend image.
- **Distrusted roots are removed** (v1.1.1): the four emSign roots, whose
  intermediate CA keys were compromised (GHSA-6q48-6c7w-9gw2), are switched
  off in Debian's store, and certifi's bundle is a link to that store, so every
  client trusts one list (and the install's extra CAs). Since v1.2.0 the two
  other bundled lists follow it too: pip's own certifi (both Pythons) is a
  link to the store, and gRPC (chromadb's telemetry exporter) reads it through
  `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH` instead of its built-in `roots.pem`
  (checked: with a one-CA list gRPC refuses a TLS connection the store
  accepts).
- **TLS verification is never disabled.** On networks that re-sign HTTPS, the
  user puts the proxy's root `.crt` in the install's `certs/` folder. The
  entrypoint runs `update-ca-certificates`, and `SSL_CERT_FILE`/
  `REQUESTS_CA_BUNDLE` make every client (httpx, requests, urllib) use the
  system bundle.

## 7. Upload and download validation

`backend/app/api/videos.py`, `backend/app/services/storage.py`,
`backend/app/utils/filenames.py`.

1. **The caption language** must be `same` or one of the nine codes, and
   the spoken language `auto` or one of them, or 422 (v1.0.11); the Hindi script (`hindi_script`) must be `roman`, `devanagari` or
   `auto`, or 422.
2. **Both** the declared content type **and** the extension must be on the
   allow-lists (415 otherwise). The extensions are `.mp4 .mov .mkv .webm
   .avi .m4v`; the types are the matching `video/*`.
3. **The size is counted while streaming,** in 1 MiB chunks, against
   `MAX_UPLOAD_SIZE_MB`. `Content-Length` is never trusted. Over the limit:
   413 and the partial file is deleted. Disk full: 507 and the partial file
   is deleted.
4. **An empty file** gets 400.
5. **The stored name is a fresh UUID** plus the allow-listed extension. The
   user's filename never reaches the filesystem; it is kept only as a label.
   `storage.resolve()` rejects any path outside the storage root, and
   recursive deletes check `is_relative_to` the root.
6. **FFmpeg opens only what the app needs** (v1.1.1, `services/media.py`;
   docs/LAUNCH_AUDIT.md S2). An upload is whatever the user downloaded, and
   FFmpeg's parsers are where a crafted file does its damage. Every run on a
   user's file passes:
   - `-protocol_whitelist file,pipe`: no URLs, so no playlist can fetch
     anything;
   - `-format_whitelist` of the six extensions' demuxers (mov/mp4 family,
     matroska/webm, avi): no concat lists, HLS, CAF, WTV…;
   - `-codec_whitelist` of common video and audio decoders (`DECODERS`):
     no PNG, Dirac, CFHD, VobSub, PGS or DVB decoding;
   - `-map` of the main picture and the main sound by index.

   Which streams those are comes from the container's headers alone
   (`ffprobe -nofind_stream_info`, the one run without the codec list: it
   decodes nothing). A cover image or picture subtitles next to a real video
   are skipped, never decoded, and the video gets the note "This file's cover
   image / picture subtitles were ignored."; text subtitles are skipped
   silently. A file whose only picture is a cover image, or whose picture is
   in a codec not on the list, is refused at upload with 415 and deleted. A
   file that isn't video at all is kept without metadata, as before, and
   transcription fails with "This file couldn't be read as a video…".
   Tested with the audit's hostile files (HLS playlists naming a local file
   and an internal URL, a concat list, corrupt, text and empty files), a CAF
   renamed `.mov`, PNG and Dirac pictures, PNG cover art, a PGS track, and
   ordinary MP4/MOV/M4V/MKV/WebM/AVI (`tests/test_media_allowlist.py`).
7. **A held upload** (v1.0.9, `hold=true`) is stored and probed like any
   other, then only listened to (the first 30 s) until it is started. The
   page deletes it on Back or close, and any held upload never started is
   deleted with its files after an hour, on its owner's next upload, so an
   abandoned upload doesn't stay on disk.
8. **Files live outside any webroot.** They are served only by
   `GET /stream` (token) and `GET /thumbnail` (owner). API responses never
   contain a filesystem path (`VideoRead` has `has_thumbnail`, not the path).
9. **Download names typed by the user** go through `safe_stem`:
   - directories are dropped (`../../etc/passwd` → `passwd`);
   - control characters, including **CR/LF, which would split the
     `Content-Disposition` header**, are removed, as are `/ \ : * ? " < > |`;
   - leading and trailing dots and spaces are trimmed;
   - the result is capped at 120 characters.

## 8. Installer checksum verification and its limits

**What it does** (`install/install.sh`, `install/install.ps1`, `vcm update`
in `install/vcm` and `install/vcm.ps1`):

- Downloads the compose files and `vcm` scripts **and** `SHA256SUMS` into
  `*.tmp` files.
- Checks every file against its line in `SHA256SUMS`.
- If any file is missing from the list or mismatches, it deletes the `*.tmp`
  files and **stops before replacing anything**: "…didn't match the release's
  SHA256SUMS; nothing was installed/changed."
- `SHA256SUMS` is produced by the release workflow from the exact files it
  attaches (`.github/workflows/release.yml`). Tampered-file tests passed on
  both platforms (`d0fb999`).

**What it does not protect against:**

- **`SHA256SUMS` comes from the same place as the files.** Anyone able to
  change the release assets (a compromised GitHub account or release) can
  change both. The check catches truncation, corruption, and a proxy or
  mirror altering one file. It does not establish who published the release.
- **The installer itself isn't verified.** `curl … install.sh | bash` and
  `irm … install.ps1 | iex` run whatever GitHub serves over TLS.
- **Images are pulled by tag, not digest** (`…:latest-cpu`, `…:1.0.4-cuda`),
  and are not signed. Their integrity rests on GHCR and TLS, and image
  content isn't covered by `SHA256SUMS`. Digest pinning and signing are on
  the [ROADMAP](ROADMAP.md).
- **Model weights:** Whisper repositories are fetched by name; the M2M100
  conversions and (v1.1.1) MiniLM are pinned to a commit. CTranslate2's `model.bin` is a
  weights format, not a pickle, so loading it cannot execute code
  (`translation.py`).
- **Google Fonts** are pinned (v1.0.5): every download comes from the commit
  of `google/fonts` the catalogue was built at (`83831d6f…`, checked: all
  1832 entries' paths and sizes match). The catalogue builder records the
  commit it read. On `main`, six of the catalogue's files had since moved.

## 9. Reporting a vulnerability

Use **GitHub private vulnerability reporting**:
`https://github.com/Tanush1206/Video-Caption-Maker/security/advisories/new`
(the repository's **Security** tab → **Report a vulnerability**). Reports
there are visible only to the maintainer until an advisory is published.

- **Never** post exploit details, secrets, `.env` contents or `audit.log`
  excerpts in a public issue.
- Include the version you run (`VCM_VERSION` in the install's `.env`; `latest`
  means the newest release at your last install or update) and the steps to
  reproduce.

The channel must be switched on in the repository settings (Settings → Code
security → Private vulnerability reporting → Enable). Until it is, the link
above does not accept reports.

## Decisions recorded

Answers from the maintainer (2026-10-14) to this document's former open
questions:

| Question | Answer |
|---|---|
| Reporting channel | GitHub private vulnerability reporting (§9). |
| Windows `.env` ACL | Acceptable: it's under the per-user `%LOCALAPPDATA%` (§5). |
| Gemini key in plain text | Acceptable for a local single-user app; confirmed never returned and never logged (fixed in v1.0.5). |
| Image digest pinning / signing | → [ROADMAP](ROADMAP.md). |
| `--forwarded-allow-ips='*'` | Fixed in v1.0.5: trusted only from the frontend container (§4a). |
| Google Fonts from `main` | Fixed in v1.0.5: pinned to a commit (§8). |
