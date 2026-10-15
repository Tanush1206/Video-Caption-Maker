# PROGRESS — from dev machine to installable product

Resume rule: re-read this file, take the first open item in the backlog
(MAJOR → UI → MINOR), and continue the loop described in the task brief.

## Decisions (Step 0, made by Tanush — 2026-10-07)

**a) Translation — both.**
- Default: M2M100-1.2B via CTranslate2 int8, fully local. MIT licence.
- If total RAM < 12 GB: M2M100-418M instead (also MIT).
- If a Gemini key is set in Settings, use Gemini. If a Gemini call fails (no
  network, quota, bad key), fall back to M2M100 automatically and show a small
  notice. A translation failure never fails the job.
- Whisper and M2M100 are never in memory together: unload Whisper before
  translating.
- Rejected: NLLB-200 (CC-BY-NC-4.0, non-commercial only); Opus-MT (one model
  per pair, weak Hindi).

**b) Semantic search — retrieval only by default.** Timestamped passages,
click to jump. Generated answers only when a Gemini key is set.

**c) Whisper defaults by hardware tier.** The user can override them in
Settings and via `WHISPER_MODEL_SIZE`.
| Tier | Model | Compute |
|---|---|---|
| GPU with ≥ 6 GB VRAM | `large-v3` (not turbo) | float16 |
| CPU with ≥ 12 GB RAM | `large-v3-turbo` | int8 |
| CPU with < 12 GB RAM, or GPU with < 6 GB | `small` | int8 |

GPU is tested with the override file; CPU-only is tested by running without it.

**d) Hosting:** GHCR images, with the install scripts as GitHub Release assets
(`releases/latest/download/install.sh`). The CI workflow for the CUDA image
needs a free-disk-space step. Tanush makes the repo and the GHCR packages
public himself, and needs reminding to do it.

**e) Git:** commit directly, with no Co-Authored-By trailer and at most ~5
files per commit. Never push. (This overrides the "never commit" memory, for
this task only.)

**Secrets:** Tanush already rotated the Gemini key, the Google OAuth secret
and the JWT secret, so they're off the backlog. Still required:
- never read, print or log `.env` values;
- the installer generates secrets on first run;
- `.env`, certs and storage can never reach an image, a commit or a release.

## Pinned GPU stack (verified working on RTX 5080, sm_120, driver 591.86)

| Package | Version |
|---|---|
| Python | 3.11.15 (`python:3.11-slim`, Debian trixie) |
| ctranslate2 | 4.8.1 |
| faster-whisper | 1.2.1 |
| nvidia-cublas-cu12 | 12.9.2.10 |
| nvidia-cudnn-cu12 | 9.24.0.43 |
| ffmpeg | 7.1.5 (Debian) |

The CUDA worker image must install exactly these versions. CTranslate2 4.x
needs CUDA 12 plus cuDNN 9, and cuBLAS ≥ 12.8 for Blackwell.

## Baseline (2026-10-07)

- Committed the ~50 pending files as 13 baseline commits (`b79c442..7a555bf`).
  Before committing I checked them for secrets, certs and build artifacts and
  found none. (The staged rename `auth-backdrop → gradient-field` went into
  `b79c442`.)
- Backend tests: 278 passed, 1 skipped, 1 failed
  (`test_instancing_produces_a_real_static_bold`: `fontTools` is missing
  because the running image predates the dependency).

## Backlog

Format: `[ ]` open, `[x]` done. MAJOR = blocks the goal or breaks
functionality; MINOR = quality or cleanup; UI = visual/UX.

### MAJOR
- [x] M1 Whisper is hardcoded to cuda/float16/large-v3 — `backend/app/config.py`,
      `backend/app/services/transcription.py`. Detect hardware (CUDA → CPU int8),
      pick the model by RAM/VRAM, allow an override.
- [x] M2 Translation needs Gemini — `backend/app/services/translation.py`.
      Implement local M2M100 + optional Gemini with fallback and a notice. Unload
      Whisper first.
- [x] M3 RAG needs Gemini — `backend/app/services/rag.py`,
      `backend/app/api/search.py`. Retrieval only unless a key is set. The key
      can be set in Settings, is stored server-side and is never returned.
- [x] M4 Auth is wrong for a local app — `backend/app/dependencies.py`,
      `backend/app/api/auth.py`, frontend `(dashboard)/layout.tsx`, `page.tsx`,
      `(auth)/*`. Add a local mode that auto-creates a user and never shows a
      login; keep the auth code intact.
- [x] M5 Upload can't carry the caption language — `backend/app/api/videos.py`
      (upload starts transcription with defaults, before a language is chosen).
- [x] M6 Dev-only images — `backend/Dockerfile` (`-e .[dev]`, certs COPY, torch
      CUDA 13 wheels → 13.5 GB), `frontend/Dockerfile` (`npm run dev`, certs).
      Needs multi-stage production builds, standalone Next, and CPU/CUDA worker
      variants. No `.dockerignore` exists.
- [x] M7 The browser talks to `localhost:8000` directly (`NEXT_PUBLIC_API_URL` is
      duplicated in 6 files), so the backend has to be exposed. Proxy `/api`
      through the frontend so only :3000 is exposed.
- [x] M8 No production compose — add `docker-compose.prod.yml` (pinned,
      127.0.0.1, healthchecks everywhere, named volumes) and
      `docker-compose.gpu.yml` (NVIDIA reservation).
- [x] M9 No installer — add `install.sh`/`install.ps1` (Docker check, disk,
      GPU, secrets, pull, health wait, open browser) and `vcm`
      start/stop/update/uninstall.
- [x] M10 No CI image build — add a GitHub Actions workflow for GHCR (cpu +
      cuda, free-disk step) that attaches the install scripts to the release.
- [x] M11 Failing test `test_instancing_produces_a_real_static_bold` — stale
      image, fixed by the rebuild; verify.
- [x] M12 End-to-end: real video, GPU and CPU, all 5 languages, export.
- [x] M13 Fresh-install test from scratch in a clean environment (done as
      R6, from the real Release, in the clean machine).

### Added by Tanush (2026-10-08)
- [x] R1 Prove no Norton/local CA is in any committed file, in a built image
      (inspect for *.crt), or in a release. Dev machine only. (Re-check the
      GHCR images in R6.)
- [x] R2 Frontend `npm run build` + `npm run lint`: run and report.
- [x] R3 Report the language pairs and engine the 12 E2E jobs covered. All 20
      pairs on local M2M100; a bad or missing Gemini key falls back without
      failing the job.
- [x] R4 Test the low-RAM CPU tier (< 12 GB → small + M2M100-418M) with a
      memory-limited worker.
- [x] R5 `vcm update` keeps videos, captions and the DB, and runs migrations.
- [x] R6 Final install test from the published GitHub Release + GHCR images.
      Tell Tanush when to make the repo and packages public. Wait for his
      confirmation after each publishing step.
- [x] R7 macOS untested: a known limitation in the README and final report.

### Added by Tanush (2026-10-08, second round)
- [x] R8 Uninstall touches only the installed project: list targets first;
      never the dev stack. DELETE path only in the clean machine; on this PC
      only the keep-data path.
- [x] R9 Answer: what the R5 downgrade dropped, which stack was rolled back and
      whether a backup existed; whether secrets can contain `$`.
- [x] R10 Remove `vcm-test-registry` and `vcm-clean` after testing (2026-10-14).

### UI
- [x] U1 3-step flow (Upload → Language → Export) with a stepper; editor,
      styling and search become secondary ("Edit captions").
- [x] U2 Processing states: model download (size + %), transcribing (% + ETA),
      translating, rendering, done with a download link.
- [x] U3 No login or landing page in local mode; Settings gets a Gemini key
      field, a Whisper model override and hardware info; account UI hidden.
- [x] U4 Consistency pass: spacing and type scale, buttons, inputs, cards,
      overflow.
- [x] U5 Responsive at 375px through wide desktop; light and dark.
- [x] U6 Accessibility: keyboard, focus rings, labels, AA contrast.
- [x] U7 Empty, loading and error states on every screen; no raw error dumps.

### MINOR
- [x] m1 Postgres/Redis/Chroma ports are exposed to the host; `chromadb:latest`
      is unpinned.
- [x] m2 README is stale (Milestone 1).
- [x] m3 Dead code and scaffolding: empty `frontend/src/components/editor/`,
      unused deps (check `react-query-devtools`, `canvas-confetti`, `zod`,
      `framer-motion`), the comment about Milestone 4 in `backend/Dockerfile`.
- [x] m4 Error handling: failed transcription, OOM, unsupported file, disk full,
      model download failure → friendly messages.
- [x] m5 Tests run against the live dev DB (conftest deletes `test-%` users) —
      document this, or isolate them.

## Done
- M1 `services/hardware.py`: three tiers. The worker reports its hardware at
  startup, because the API container has no GPU to look at. Precedence for
  the model: Settings, then env, then auto. A GPU that fails to load falls
  back to CPU int8 with a notice. (`aa8e80e`)
- M2 `services/translation.py`: M2M100 via CTranslate2 int8, using
  `jncraton/m2m100_{1.2B,418M}-ct2-int8` (MIT) pinned to a commit. Gemini is
  tried first when a key is set, with a 60 s timeout, and falls back to local
  with a notice. Whisper and the translator unload each other. (`dc77d43`,
  `7ac5f51`)
- M3 Search answers need a key; retrieval doesn't. The key lives in
  `app_settings`, is set via `PATCH /api/system/settings`, and only
  `gemini_configured` is ever returned. (`dc77d43`, `9ab2721`)
- M4 (backend) `AUTH_MODE=local` (default): one auto-created user, and
  `/auth/refresh` works without a cookie. Accounts mode is unchanged and is
  what the test suite runs in. (`8ca8596`). The frontend part is in U3.
- M5 Upload accepts `caption_language`. (`9ab2721`)
- M11 The font test passes once `fonttools` is installed. The image rebuild
  makes that permanent.
- Model downloads report byte progress (`stage=downloading`, `stage_detail`
  "… 1.2 of 2.9 GB"). Failed jobs store a sentence, not a traceback.
- Verified on GPU (dev stack): Hindi → fr (Gemini), Hindi → same with
  large-v3, Hindi → de with local M2M100. SRT/VTT exports download.
  `scripts/e2e.py` is the reusable driver.
- Tests: 300+ pass (`test_local_install.py` added).

- M7 (code) `lib/config.ts` is the single API base, empty in production. Next
  rewrites `/api/*` to `backend:8000`, with a 30 min proxy timeout for
  uploads. (`fd7a368`, `52b0e45`)
- U1 Dashboard: a stepper (Upload → Language → Export), a keyboard-reachable
  drop zone, and the language chosen before upload. Video page: a status card
  with one-click MP4/SRT/VTT export; editing and styling sit below it as
  optional. (`959f113`, `7d7d1a1`)
- U2 Processing: stage, %, ETA (from the observed rate), download size, a
  translating stage, and a render % with the download. (`7d7d1a1`)
- U3 Local mode: middleware sends `/`, `/login`, `/register` to the
  dashboard; no account menu; a retrying "can't reach the app yet" state;
  Settings shows hardware, the model choice and the Gemini key. (`bc4f74a`,
  `9e4a046`)
- U5 (partial) Fixed the editor's 124 px sideways scroll at 375 px and the
  player controls wrapping.
- U6 (partial) Light success and warning text now pass AA (5.46 and 5.29:1).
  `next lint` had no config and prompted interactively; it is now
  configured and clean.
- Search is retrieval-only without a key. (`fd4e793`)
- Found: the dev compose mounted Chroma at `/chroma/chroma`, but Chroma 1.x
  persists to `/data`, so dev vectors were never on the volume. Fixed in both
  compose files.
- Production compose project renamed to `vcm`, so it can't orphan or remove
  the dev stack (project `videocaptionmaker`).

- M6 Production images: multi-stage backend (`VARIANT=cpu|cuda`), with the
  CUDA libs moved to an extra (CPU image 7.3 → 3.5 GB; 0.8 GB compressed;
  CUDA 2.3 GB compressed). Standalone Next frontend (0.05 GB). No certs, no
  dev deps, no source. Constraints pin the verified stack. (`f594b6d`,
  `e589f67`)
- M8 `docker-compose.prod.yml` + `docker-compose.gpu.yml`: pinned images,
  UI-only port on 127.0.0.1, healthchecks everywhere, named volumes, project
  `vcm`. (`4384ff2`)
- M9 `install.sh`, `install.ps1`, `vcm`, `vcm.ps1`/`vcm.cmd`. (`de8a875`)
  PS 5.1: native stderr under `ErrorActionPreference=Stop` is terminating, so
  the scripts use `Continue` plus explicit exit-code checks.
- M10 `.github/workflows/release.yml` (GHCR cpu/cuda/frontend, free-disk
  step, release assets) and `ci.yml`. (`90cc5d4`)
- M12 GPU E2E through the installed prod stack: 2 clips × 6 targets (same,
  en, hi, fr, de, nl), each exporting SRT/VTT/MP4. **ALL PASSED.**
- M13 Windows installer on this host (GPU variant, port fallback to 3001)
  and `install.sh` in a clean docker:dind machine with 0 images (CPU
  variant): both installed and came up healthy.
- After a reboot, both stacks came back on their own (`restart:
  unless-stopped`).
- Norton TLS interception: its root CA was regenerated after the reboot. The
  runtime `certs/` folder plus `vcm restart` fixes it for users;
  `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE` now cover httpx too. Builds take the CA
  as a BuildKit secret. (`fc3b6da`)
- Long large-v3 segments are split into captions of ≤ 84 chars / ≤ 6 s.
  (`816bfa1`)
- Hindi burn-in renders (Poppins has Devanagari). `fonts-noto-core` was added
  as a fallback for other scripts.
- U6: axe-core finds 0 WCAG 2 A/AA violations on dashboard, editor, settings
  and search in both themes; every keyboard stop shows a 2 px outline.
- U7: 5xx and network errors are sentences; disk full is a 507 that says so.
- m5: README notes that the tests use the dev database.

- R1: `git log --all` has never tracked a `.crt`/`.pem`. In all three built
  images, no cert outside the distro store, an empty extra-CA dir, and the
  Norton root's fingerprint in no bundle.
- R2: `npm run lint` clean; `npm run build` succeeds.
- R3: GPU E2E covers 5 spoken languages (en, hi, fr, de, nl) × 6 targets
  (same, en, hi, fr, de, nl) = 30 jobs, all passed, local M2M100-1.2B (X→en
  via Whisper translate). M2M100 service level: 20/20 pairs. An invalid
  Gemini key falls back to local with a notice; the job succeeds.
- R5: on the GPU install, rolled back one migration (a9d3e6f20b14 →
  f1c93d05a827), then `vcm update`: upgrade ran on start, 12 videos /
  136 captions / 36 exports and the caption-text md5 unchanged. That
  downgrade drops `app_settings` and `videos.stage_detail`/`videos.notice`;
  after the upgrade all 12 older videos have both NULL, and `app_settings`
  holds only `worker_hardware` (re-reported by the worker on start). No
  backup was taken first, so whether any of those held a value before is
  unknown. A real `vcm update` only upgrades, so it drops nothing.
- Low-RAM Hindi: Whisper small skipped every window as not-speech (0
  captions, no error). An empty pass now retries without the no-speech
  check, with a notice. (`b8c446a`)
- DejaVu Sans was offered but missing from the image once `fonts-noto-core`
  satisfied fontconfig's dependency; installed explicitly. The dev image now
  builds behind a TLS proxy. (`5a897db`)
- R8: uninstall used `down --rmi all`, which targets `chromadb/chroma:1.0.0`,
  shared with the dev stack. Now it removes only `video-caption-maker-*`
  images and guards the directory delete. On this PC, keep-data uninstall
  removed exactly the 6 `vcm-*-1` containers and 2 app images; dev stack
  containers, volumes, images and DB checksum identical. Reinstall picked
  the data back up (32 videos). `vcm status` shows stopped containers.
  (`07f0326`)
- Secrets are 64 hex chars (`openssl rand -hex 32` / RNG bytes as `x2`):
  never `$`. Verified on both installs' `.env` without printing values.

- R4: worker capped at 8 GB (cgroup) → small int8 + m2m100_418M. English
  and German clips × 6 targets passed; Hindi × 6 passed after `b8c446a`
  (9-22 captions; 4 of 6 carry the low-confidence notice).
- R8 DELETE path, clean machine only: removed the 6 containers, 5 `vcm_*`
  volumes, `vcm_default`, the 2 app images, the install dir and the `vcm`
  link. Base images (postgres, redis, chroma) and an unlabelled volume kept.
- U4/U5: 5 screens × desktop 1440 / mobile 375 × light/dark on the release
  build: no console errors, no horizontal overflow; reviewed by eye.

- R6 progress: pushed `main` (CI green on `ac2251c`); repo public (intended);
  tag v1.0.0 → release workflow green: GHCR backend (1.0.0-cpu/-cuda,
  latest-*) and frontend, Release with 8 assets; both packages public
  (anonymous manifest fetch 200, confirmed by Tanush).
- Found before the final test: the installers never checked SHA256SUMS.
  Now install.sh, install.ps1 and `vcm update` verify every file before
  replacing anything; tampered-file tests pass on both platforms
  (`d0fb999`). DELETE uninstall left redis's anonymous volume; fixed
  (`95f5952`). Both need a v1.0.1 release.
- Test install on this PC deleted (approved by Tanush): exactly the 6
  containers, 5 `vcm_*` volumes, 2 test images and the folder; dev stack
  diff empty.

- v1.0.1 published (all 4 release jobs green; `latest` digests = 1.0.1).
  Final install test, commands copied from the README on GitHub, no
  overrides: clean Linux (CPU, large-v3-turbo int8) and Windows default
  location (GPU, large-v3 fp16, port 3001) both installed, both logged
  "Downloaded files match the release's SHA256SUMS", both healthy on GHCR
  images. Behind Norton, the first model download gave the friendly
  certificate message; the README fix (certs/ + `vcm restart`) worked.
- R1 rechecked on the published GHCR 1.0.1 images: no extra CA, empty
  `/usr/local/share/ca-certificates`, no `.env`; Norton root (both versions)
  in no bundle.
- Docker restarted mid-E2E: both installs and the dev stack came back on
  their own, but the job in flight stayed "processing" forever (Redis isn't
  persisted; retry refused). Fixed: the worker requeues stranded jobs on
  start; verified live (`8e137c0`). Needs v1.0.2.

- Tanush: the startup requeue could loop forever on a job that crashes the
  worker (OOM). Added `recovery_attempts` (migration `b4e7c2d91a36`): each
  requeue is counted and committed before the task is sent; after 3, the
  job fails with "…ran out of memory. Choose a smaller speech model…"; a
  manual retry resets the count. 5 tests (`8c4a461`, `98202fe`). The worker
  uses `--pool=solo`, so an OOM kill takes the container down and Docker's
  restart runs recovery: there is no child-only kill that would skip it.
- The temporary patch on the clean install lives only in `vcm-worker-1`'s
  writable layer (`docker diff`); `vcm update` recreates the container from
  the new image. Staging copies removed.

- v1.0.2 published (4 jobs green). `vcm update` from the real Release on
  both installs: SHA256SUMS verified, migration a9d3e6f20b14 → b4e7c2d91a36
  ran, row counts and caption md5 unchanged (Linux 11/190/27, Windows
  1/14/3), version 1.0.2, temporary patch gone (`docker diff`). Linux pull
  took 68 min: nested dind network at ~220 KB/s vs 8.5 MB/s on the host
  (test-harness path). Windows took ~10 min on Wi-Fi.
- Windows install: videos 1, 3-7 were deleted at 08:22 UTC on 2026-10-11
  (6 DELETEs through the frontend proxy, ~2 s apart, after a dashboard load
  at 08:22:04). Tanush: not him, so treated as a bug. Only 7 videos ever
  existed; the id sequence at 37 is Postgres's 32-value prefetch after an
  unclean shutdown. See R11.
- Real OOM test (clean worker capped at 1 GB, large-v3-turbo forced) found
  that a job killed mid-run sits in Redis's unacked set, so recovery treated
  it as held; Redis would redeliver it hourly, outside the counter. Fixed:
  the starting worker takes over unacked video/export jobs (`02a4576`).
  Verified live: take over → 3 requeues across 3 OOM kills → failed with
  the smaller-model message; broker empty; worker stable. Then automatic
  model (small) + manual retry: attempts reset to 0, completed, 14
  captions. Cap removed; worker recreated from the v1.0.2 image.
- Found: every release re-downloads the whole backend image (all layers
  above the OS base changed 1.0.1 → 1.0.2: 765 MB CPU, 2,246 MB CUDA)
  although no dependency changed. Cause confirmed with two local builds
  differing only in VERSION: layers 4-13 changed (`ARG VERSION` at the top
  of the runtime stage). Moved ARG/LABEL/VCM_VERSION to the end of both
  Dockerfiles: 14/14 and 9/9 layers identical. CI switched from the Actions
  cache (10 GB, 7-day eviction) to a GHCR registry cache (`949fe9d`). The
  update to v1.0.3 is still a full download; the savings start after it.

- R11 (the 08:22 deletions). Ruled out: the app by itself (one delete path,
  two clicks per video, mutations never retry, `request()` retries only on
  401), Playwright/test scripts (`shoot.js` screenshots only, `e2e.py`
  never deletes), any Claude session (transcripts show no port-3001 call
  then), and cross-site pages (CORS allows only localhost:3000). The actor
  stays unknown: uvicorn logs no User-Agent/Origin, and `vcm update`
  replaced the container. Fixed what made it possible and unrecordable
  (`491ebee`): in local mode the API refuses non-local hosts (DNS
  rebinding, reads too) and state changes that are cross-site, same-site
  from other origins, or from a non-local Origin; every DELETE, settings
  change and refusal goes to `storage/audit.log` (persistent; no bodies).
  8 tests; 6 fail with the guard removed. Proxy headers measured with the
  real frontend image in front of an echo server. Dev UI in a real browser:
  0 of 20 API calls refused; rebinding and cross-site probes refused (403)
  and written to the audit log.

- Port: Tanush's install moved to 3000 with the installer's own setting
  (`$env:VCM_PORT='3000'` + the README one-liner; `.env` VCM_PORT=3000
  written by the installer, data and md5 unchanged); a browser lands on
  "Your videos" at http://localhost:3000. Only one of install and dev can
  hold 3000: `vcm stop` before `docker compose up`. Dev stack left stopped.
- Guard hole found before release: production compose never sets
  CORS_ORIGINS, so the guard's same-site allowance trusted the default
  http://localhost:3000 on every install, including one moved to 3001.
  Now, through the proxy, Origin must equal the forwarded host exactly
  (`72ea1fa`); CORS_ORIGINS only for direct (dev) calls; `null` refused.
  The dev-app and null cases fail on the previous rule. 325 passed.
- audit.log is capped: rotates at 5 MB to audit.log.1 (replacing the old
  one), so at most two files of ~5 MB; tested.
- Moved-port live test (clean machine, installer moved it to 3001, images
  built from this code, Chromium inside its network): at localhost:3001
  and at 127.0.0.1:3001 the UI deleted (204), saved settings twice (200),
  exported SRT and a burned MP4 (downloaded); 0 requests refused. A probe
  with Origin http://localhost:3000 and a rebinding Host: 403, recorded
  with reasons. The clean install keeps these test images until v1.0.3.
- Test harness: a hard Docker stop left a stale containerd pid in
  `vcm-clean`; emptying that one file brought it back with data intact.

- v1.0.3 released (tag on 0360f47; release run 38248686342, 10 min, all
  4 jobs green; 6 image tags on GHCR; `buildcache-*` tags now exist; the 7
  assets from `releases/latest/download/` match SHA256SUMS).
- `vcm update` 1.0.2 -> 1.0.3 on both installs, from the real Release:
  - Windows (CUDA, port 3000): exit 0, 308 s. 1 video before and after.
  - Clean machine (CPU, port 3001, was on 1.0.3-test images): exit 0,
    2177 s (nested Docker pulls at ~0.3-0.6 MB/s). 8 videos before and
    after; test images gone, only the GHCR 1.0.3 images left.
  - Both: VCM_VERSION=1.0.3, alembic head b4e7c2d91a36. Live guard, at
    localhost and 127.0.0.1: another port's Origin, cross-site, and a
    rebinding Host -> 403 with reasons in audit.log; the app's own origin
    passes (404 on a missing id). The clean install's audit.log kept its
    entries from before the update (it lives on the media volume).

### Update download baseline (v1.0.3), for the v1.0.4 comparison
Measured with `scripts/update_layers.py`: snapshot of the daemon's layer
chains just before `vcm update`, then each published layer checked
against it. Sizes are compressed (bytes on the wire). This update was a
near-full download on purpose: 949fe9d moved the version ARG, so every
layer after the base changed once. Layer map (runtime stages): backend
1-4 python base, 5 apt, 6 venv, 7 `frontend/public/fonts`, 8 fc-cache,
9 WORKDIR, 10-13 alembic/app/entrypoint, 14 chmod; frontend 1-4 node base,
5 WORKDIR, 6 user, 7 standalone build, 8 static, 9 public. Expectation
for v1.0.4 (UI redesign): backend 0 layers downloaded if no backend code
and no `frontend/public/fonts` change (a code change: only 10-14, about
1.3 MB); frontend only 7-9 (about 6 MB).

| Install | Image | Layers downloaded | Bytes (manifest) | NIC received |
|---|---|---|---|---|
| Windows | backend 1.0.3-cuda | 10 / 14 | 2245.7 of 2291.2 MB | 2272.1 MB (all of `vcm update`) |
| Windows | frontend 1.0.3 | 5 / 9 | 6.2 of 54.6 MB | (included above) |
| Clean | backend 1.0.3-cpu | 10 / 14 | 764.6 of 810.1 MB | 931 MB (all of `vcm update`) |
| Clean | frontend 1.0.3 | 5 / 9 | 6.2 of 54.6 MB | (included above) |

Image config digests: backend-cuda `sha256:83042c9bcf74…`, backend-cpu
`sha256:abdd82c18c25…`, frontend `sha256:e635ffd239ff…`. Local image IDs
(containerd store, index digest): cuda `9ba8497ee560`, cpu `f4491def0782`,
frontend `716d0ebd7d44` (same on both machines).

Backend 1.0.3-cuda layers (compressed digest, size):
1 `26c307b5e35a` 29.8 MB · 2 `2835c5519717` 1.3 MB · 3 `bbaff5426d0f`
14.4 MB · 4 `0fc9203b193a` 0 · 5 `8eeae217effa` 193.9 MB · 6
`5b4ed3e42bdc` 2050.5 MB · 7 `463b461ba131` 1.1 MB · 8 `43b73cf49b01` ·
9 `4cacf3397e6c` · 10 `a485bbfb8685` · 11 `ded38dd01917` · 12
`3a9f86e1e2c7` 0.2 MB · 13 `09ae2f1fda64` · 14 `54dfedd601ca` (8-14
under 0.1 MB unless shown).

Backend 1.0.3-cpu layers: 1-4 as cuda · 5 `1c1a0c2bbdfb` 193.9 MB · 6
`074e6e2cb3b8` 569.5 MB · 7 `ceb906971249` 1.1 MB · 8 `0032217a802d` ·
9 `249182d00ee7` · 10 `5d06b2a71cf1` · 11 `6dca60be5b98` · 12
`06f7640e4b05` 0.2 MB · 13 `4f603ad95c5a` · 14 `17214be8faea`.

Frontend 1.0.3 layers: 1 `6a0ac1617861` 3.9 MB · 2 `4feea04c1543` 43.2 MB
· 3 `b2cbbfe903b0` 1.3 MB · 4 `fff4e2c1b189` · 5 `ef6304ff3eec` · 6
`1d472a580365` · 7 `c0f67c7d715e` 4.5 MB · 8 `116e639e8321` 0.7 MB · 9
`a2b2c22027ec` 1.1 MB.

The NIC figure includes TLS, the compose/script downloads and (clean
machine) retries; compare manifest bytes release to release.

- v1.0.3 E2E, Linux CPU install (large-v3-turbo int8, M2M100-1.2B): 3
  clips (en, hi, fr) × 6 targets = 18 jobs, each SRT/VTT/MP4: ALL PASSED.
- Tanush: postpone the DELETE uninstall test until after v1.0.4; the clean
  machine is the only CPU install and measures the v1.0.4 update.

### v1.0.4 redesign log
Rules: restyle only, all logic kept, no mock data (every figure comes from
the API), one screen at a time; each: screenshots 375/1440 × light/dark,
axe WCAG A/AA, tsc + lint, production build (docker `--target build`, so
the dev server's .next is untouched), interaction check, commit.
Preview: host `next dev -p 3100`, read-only against the install's backend
through a 127.0.0.1:8001 relay container (`vcm-redesign-relay`).
- Tokens (`e0eae23`): DESIGN.md palette/Geist/8px. Geist bundled via
  next/font/local, not public/fonts (that folder ships in the backend
  image). AA adjustments: fill #5B5EF0/#4F46E5, dark indigo text #818CF8,
  light muted slate-600.
- Dashboard (`022a396`, `60b07cb`, `87fa9ae`): shell (segmented nav, host +
  worker-hardware chips, footer, phone tab bar), stepper bar, hero drop
  zone, project cards grid + list view, first-run step cards. Not shown:
  the app version (the API doesn't expose it; adding it would be logic),
  "inference speed" tiles (no real figure). axe 0.
- Language step (`8dd98f9`): caption language as radio cards with each
  language's own name; spoken audio stated (uploads always auto-detect;
  the upload API takes no spoken language). Found and fixed a pre-existing
  bug: tailwind-merge read `text-body-md` as a colour and dropped
  `text-primary-foreground`, so medium primary buttons had dark labels.
  Real upload through it: 201, caption_language=hi, lands in the editor.
- Processing / failed (`3ad3d1d`): the worker's own stage list with
  done/active/queued; the one-time download card only for a real download
  (the worker also reports "downloading" while loading a cached model).
  Failed state shot from the clean install's real failure (relay chain to
  its backend). No live transcript, cancel or memory figures (no API).
- Editor (`cfbda0c`, `e4b1412`): editor bar (title, length, languages,
  Export), two columns, transcript pinned right, phone bottom bar; style
  studio as Typography/Appearance/Position tabs; caption rows with
  'Check this line' for low confidence. Export moved into a dialog.
- Export dialog (`db5741c`): five format cards, file name, resolution,
  render progress, previous exports. Real SRT and MP4 exported and
  downloaded through it.
- Search (`64fc9b6`): results grouped by video, preview panel. No term
  highlighting (semantic matches have no matched words).
- Settings (`c51dad9`): hardware, model cards (same PATCH; round trip
  verified and restored to auto), translation engine in use, disk, theme.
- Also verified: first-run cards (test-only empty stub), delete through a
  card (204, gone), axe 0 on dashboard/search/settings/editor, both themes.
- v1.0.3 E2E, Windows GPU install (large-v3 float16, M2M100-1.2B): 5 clips
  × 6 targets = 30 jobs, each SRT/VTT/MP4: ALL PASSED.
- Follow-up, not in the design list: there is no custom 404 page (Next's
  default shows); unchanged from before.
- Since v1.0.3 no file under backend/, install/, the compose files or
  frontend/public changed, so the v1.0.4 backend image should be
  layer-identical and the update should download only frontend layers.

### v1.0.4 released and measured (2026-10-14)
- Tag v1.0.4 on 2e84748; CI run 38266875126 green; release run
  38267107963 green in 2 min (registry cache hit: backend jobs 27 s and
  1 m 48 s vs 5 and 10 min for 1.0.3). 8 assets match SHA256SUMS.
- Docker Desktop had been quit (no reboot); on start, the Windows install
  came back healthy by itself; `vcm-clean` exited 255 once and started on
  the next `docker start`.
- `vcm update` 1.0.3 → 1.0.4 from the real release:

| Install | Image | Layers downloaded | Bytes (manifest) | NIC received | Time |
|---|---|---|---|---|---|
| Windows | backend 1.0.4-cuda | 0 / 14 | 0 of 2291.2 MB | 89.6 MB* | 23 s |
| Windows | frontend 1.0.4 | 3 / 9 (#7-#9) | 6.1 of 54.4 MB | (incl.) | |
| Clean | backend 1.0.4-cpu | 0 / 14 | 0 of 810.1 MB | 9.6 MB | 20 s |
| Clean | frontend 1.0.4 | 3 / 9 (#7-#9) | 6.1 of 54.4 MB | (incl.) | |

  \*the Windows adapter counts everything the PC received in those 23 s;
  the isolated clean machine's 9.6 MB is the update alone (layers, scripts,
  manifests, TLS). vs 1.0.3: 2245.7 MB / 764.6 MB of backend downloaded.
- Every backend layer digest (cuda and cpu, all 14) is identical to the
  1.0.3 baseline; only the image config changed (version label/env), as
  the layer-order fix intended. Frontend: base layers 1-6 identical; new
  #7 `d2123e280126` 4.5 MB, #8 `b26ca41c2544` 0.5 MB, #9 `72ee9e46f9ee`
  1.1 MB. Pull logs agree: only those three "Pull complete".
- After: VCM_VERSION=1.0.4 and alembic head on both; video lists identical
  to before (Windows 31, clean 26); Windows guard 403/404/403 live; axe 0.
- New UI through the guard on the clean install, Chromium in its network,
  at localhost:3001 and 127.0.0.1:3001: delete (204), speech model change
  and back (200, 200), SRT and burned MP4 exported through the dialog and
  downloaded, 0 refused. 14/14 PASS.

### DELETE uninstall (clean machine, v1.0.4)
`vcm uninstall`, answered DELETE at the terminal prompt: exit 0. After it,
inside the clean machine: 0 containers, 0 volumes (the five vcm_* and
redis's anonymous one), no vcm_default network, no app images,
~/.videocaptionmaker and the vcm command gone. Kept by design: the shared
postgres/redis/chroma base images. Host untouched: the Windows install and
the dev stack's videocaptionmaker_* volumes are all still there.

### Secrets (final)
No .env, key, cert, dump or storage file is tracked or ever was in git
history; .env, */certs, backend/storage, *.dump and design/stitch are
ignored. Release assets are the 7 scripts/compose files + SHA256SUMS. In
the 1.0.4 images: no .env/key files (the frontend's one .pem is Alpine's
public CA bundle), the extra-CA dir is empty, NODE_EXTRA_CA_CERTS unset,
the Norton root is not in the backend's CA bundle; the backend builds from
an allow-list (backend/Dockerfile.dockerignore).

### R10 cleanup (by name only)
Removed: containers vcm-clean and vcm-test-registry with their own
anonymous volumes; images docker:29-dind, registry:2, the Playwright image,
localhost:5000/* test images, vcm-redesign-build, and the backend -cpu
images (only the clean machine used them). Left in place because they may
be yours: busybox, shellcheck, actionlint, python/node base images, older
ghcr 1.0.1/1.0.2 tags, three unnamed volumes, llm-utility-lab,
chromadb:latest.

## Done
v1.0.4 is released, both installs were on it and verified; the clean
machine is uninstalled and removed. Reminder: the install and the dev
stack both use port 3000: `vcm stop` before `docker compose up`.

### Documentation (2026-10-14)
Docs only; no code, config or test changed. All content is taken from the
code, the config, the tests, git history, this file and the technical parts of
learning-guide.md.
- New in `docs/`: PRD, DATABASE (schema from `\d` on the v1.0.4 install),
  API (generated from `app.openapi()` in the v1.0.4 backend), SECURITY,
  ENVIRONMENT, DESIGN_SYSTEM, CODE_STYLE, TESTING, DECISIONS.
- `architecture.md` rewritten as ARCHITECTURE.md; roadmap.md marked
  historical.
- New at the repo root: CHANGELOG.md (v1.0.0–v1.0.4), AGENTS.md, and
  CLAUDE.md (which points to AGENTS.md). README has a Documentation section.
- Mismatches found while writing are listed under each doc's
  "Open questions", not fixed. The main ones:
  - `translation_available` disables hi/fr/de/nl in the editor's Redo when
    no env Gemini key is set;
  - deleting a video leaves its export files;
  - Celery's 35 min hard limit vs the 3 h render timeout;
  - `STORAGE_BACKEND`, `MODEL_CACHE_DIR` and the `S3_*` variables are
    unused;
  - the dev compose defaults to the CUDA variant.

## v1.0.4: UI redesign (do NOT start until Tanush says so; only after
## v1.0.3 is released and verified)
Source: `design/stitch/` (gitignored). Use ONLY these folders; ignore every
other version there. Where a screen.png and its code.html disagree, follow
code.html.

| Folder | Screen |
|---|---|
| dashboard_projects_2 | Dashboard (desktop, dark) |
| dashboard_first_use_empty_state_2 | First-use empty state |
| language_configuration_2 | Language step |
| processing_2 | Processing |
| processing_failed_2 | Processing failed |
| video_caption_editor_3 | Caption editor |
| export_modal_formats_3 | Export modal |
| cross_video_semantic_search_4 | Search |
| settings_hardware_4 | Settings |
| dashboard_light_theme_2 | Dashboard (light) |
| video_caption_editor_light_theme_2 | Editor (light) |
| mobile_dashboard_2 | Mobile dashboard (375px) |
| mobile_language_step_2 | Mobile language step (375px) |
| mobile_settings_2 | Mobile settings (375px) |
| mobile_video_caption_editor_2 | Mobile caption editor (375px) |
| local_video_studio_engine/DESIGN.md | Design tokens |

All 15 folders (code.html + screen.png each) and DESIGN.md verified present
on 2026-10-12.

## v1.0.5 (released 2026-10-14)
Tanush answered the docs' open questions; the docs now record the answers
("Decisions recorded" in each), and later items are in docs/ROADMAP.md.
One commit per fix, each with tests:
- Isolated tests (`62bf07a`): `<db>_test` rebuilt from migrations every run,
  Redis db 14, `captions_test`, temp storage. Dev DB untouched (0 `test-%`).
- CI runs ruff + the backend suite (`6f1fe9d`); `backend/ruff.toml`, not
  pyproject (pyproject is in the deps layer: editing it = full update).
- Editor offers all five languages offline (`160781f`).
- Celery limits removed (`17367ff`): measured, `--pool=solo` never enforced
  them (6 s task under a 3 s hard limit completed).
- Dev compose CPU by default (`2089492`). Tanush: if your dev `.env` has no
  `VCM_VARIANT`, add `VCM_VARIANT=cuda` to keep building the GPU image.
- Video delete removes export files (`3fd56b2`; test fails without it).
- Gemini key: never returned (all GETs checked) but WAS logged by dev SQL
  echo; `hide_parameters=True` on both engines (`f2e9ca6`).
- `/api/ask` without a key says a key is needed (`bde0889`).
- API version = VCM_VERSION (`369a30e`).
- Forwarded headers trusted only from `frontend` (`3a418bf`); live check on
  the dev network: aliased container believed, other container not.
- Google Fonts pinned to `83831d6` (all 1832 entries' paths and sizes match;
  6 had moved on main and 404'd) (`2aabf29`).
- Unused settings removed, .env.example matches installer (`d270caf`);
  upload limit 4096 (`b63ed42`, `7e7ed6f`).
- System theme (`2c0f020`), custom 404 (`fc402f7`), Retry with small model
  (`87aa211`), light destructive rose-700 for AA (`eb1c345`, found by axe on
  the failed state). Harness in scripts/ui-check (`73be0c8`, `3206d9f`,
  `13b9403`): theme 9/9, not-found 4/4, retry-small 2/2, editor-languages
  2/2, axe 0 on dashboard/search/settings/404/failed state.
- Backend: 350 passed, 1 skipped; ruff clean; production frontend build OK.
- Backup/restore (DATABASE.md §7) tested: Windows install backed up (15 s
  downtime), restored into throwaway project `vcmbk`: counts, caption md5,
  head and media checksum identical; `vcmbk` removed (`down -v`), backups
  deleted.
- To do by Tanush: enable GitHub private vulnerability reporting (Settings →
  Code security → Private vulnerability reporting).

### v1.0.5 released and measured (2026-10-14/15)
- Tag v1.0.5 on 750e392; CI run 38580282498 (scripts, backend, frontend)
  and release run 38580381042 (3 image jobs + release) green. 8 assets, all
  match SHA256SUMS from `releases/latest/download/`. Anonymous GHCR
  manifests 200 for 1.0.5-cpu/-cuda, latest-cpu/-cuda, frontend
  1.0.5/latest; latest = 1.0.5 digests.
- `vcm update` 1.0.4 → 1.0.5 from the real release:

| Install | Image | Layers downloaded | Bytes (manifest) | NIC received | Time |
|---|---|---|---|---|---|
| Windows | backend 1.0.5-cuda | 3 / 14 (#12-#14) | 0.2 of 2291.2 MB | - | 28 s |
| Windows | frontend 1.0.5 | 3 / 9 (#7-#9) | 6.1 of 54.4 MB | | |
| Clean | backend 1.0.5-cpu | 3 / 14 (#12-#14) | 0.2 of 810.1 MB | 10.9 MB | 26 s |
| Clean | frontend 1.0.5 | 3 / 9 (#7-#9) | 6.1 of 54.4 MB | (incl.) | |

  Backend layers 1-11 (incl. the 2050 MB deps layer) reused, as intended by
  keeping ruff config out of pyproject. vs 1.0.4: 0 + 6.1 MB.
- After, on both: VCM_VERSION and API version 1.0.5, alembic b4e7c2d91a36
  (no migration), counts, caption-text md5, video list and media checksum
  identical (Windows 31/505/93, 178 files; clean 2/6/3, 7 files).
- Guard on both, at localhost and 127.0.0.1: another port's Origin,
  cross-site and rebinding Host (POST and GET) 403; own origin passes.
- **Found here; fixed after the release (unreleased, see below):** the Next proxy does not add
  X-Forwarded-For; it only passes through one the caller sent. So through
  the frontend, `audit.log`'s `client` is the frontend container's IP for
  normal requests (worker → frontend with no header recorded 172.19.0.5,
  the frontend), and whatever a caller puts in X-Forwarded-For is recorded
  (198.51.100.7, 203.0.113.9 tested). `3a418bf` stops direct spoofing at
  the API, but SECURITY.md §4a's "the browser's address when the request
  came through the frontend" does not hold in installs.
- Windows UI flow (`flow.js`) at localhost and 127.0.0.1: 7/7 PASS each,
  0 refused; speech model restored to auto.
- E2E (pipeline changed: Celery limits): Windows GPU 2 clips × same,hi with
  SRT/VTT/MP4, ALL PASSED (2 m 30 s); clean CPU (high tier) same,hi,fr ALL
  PASSED (43 s). The 4 E2E videos on Windows were deleted afterwards.
- Clean machine: fresh `docker:29-dind` `vcm-clean`, v1.0.4 installed from
  its release assets (images side-loaded; Norton root in the dind CA store
  and the install's `certs/`), then `.env` switched to `latest` like a real
  install. A Docker Desktop shutdown mid-E2E interrupted a translation; on
  restart, recovery requeued it and it completed.
- Secrets: no .env/key/cert/dump/storage file in git history
  (`docs/learning-guide.md` was tracked in 79da389 and removed in 4dc2628,
  2026-08-06; pushed, so it is in public history; scanned: no keys, tokens,
  64-hex secrets or local paths). Images: no .env/key files, empty
  extra-CA dir; the only .pem is grpc's public roots bundle (115 certs, no
  private key).
- Removed by name: `vcm-clean` (+ its volume), docker:29-dind,
  backend:1.0.4-cpu, frontend:1.0.4 tags, test clips. The dev stack was
  stopped (not removed) for port 3000 and left stopped, as asked.

## Unreleased (after v1.0.5)
- Forwarded headers through the frontend: `frontend/forwarded-for.js`,
  preloaded with `node -r` (runtime image) and `NODE_OPTIONS` (dev compose),
  overwrites X-Forwarded-For/-Proto with the frontend socket's peer before
  Next proxies `/api`. Tests: `frontend/tests/forwarded-for.test.js` (3; all
  fail without the preload; one goes through Next's `proxyRequest`), run by
  `npm test` in CI. Live on the built runtime image behind a published port:
  a forged 203.0.113.9 + https from the host reached the backend as
  172.20.0.1 (Docker gateway) + http; from a container, as that container.
  SECURITY.md §4a rewritten. Test container/network/image removed. Ships
  with the next release; the dev stack wasn't started, so the
  `NODE_OPTIONS` path is untested live there.
