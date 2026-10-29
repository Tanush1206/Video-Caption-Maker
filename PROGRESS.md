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

## v1.0.6 (released 2026-10-15)
- Forwarded headers through the frontend: `frontend/forwarded-for.js`,
  preloaded with `node -r` (runtime image) and `NODE_OPTIONS` (dev compose),
  overwrites X-Forwarded-For/-Proto with the frontend socket's peer before
  Next proxies `/api`. Tests: `frontend/tests/forwarded-for.test.js` (3; all
  fail without the preload; one goes through Next's `proxyRequest`), run by
  `npm test` in CI. Live on the built runtime image behind a published port:
  a forged 203.0.113.9 + https from the host reached the backend as
  172.20.0.1 (Docker gateway) + http; from a container, as that container.
  SECURITY.md §4a rewritten. Test container/network/image removed. Ships
  with the next release.
- Dev stack verified (2026-10-15), frontend recreated with
  `NODE_OPTIONS=--require /app/forwarded-for.js` (one `next dev` process).
  Cross-site POSTs with forged X-Forwarded-For, read from audit.log:
  host → dev frontend (203.0.113.9) recorded `::ffff:172.18.0.1` (dev
  network gateway); worker → frontend (198.51.100.7) recorded
  `::ffff:172.18.0.6` (the worker); control, host → backend:8000 directly
  (192.0.2.44) recorded `172.18.0.1`. `next dev` listens dual-stack, so dev
  addresses are IPv4-mapped (`::ffff:`); the runtime image (HOSTNAME=0.0.0.0)
  records plain IPv4.

### v1.0.6 released and measured (2026-10-15)
- Tag v1.0.6 on b8a0025; CI run 38704686755 and release run 38707130530
  (4 jobs) green, release in ~2.5 min. 8 assets match SHA256SUMS; anonymous
  GHCR 200 for 1.0.6-cpu/-cuda, latest-*, frontend 1.0.6/latest.
- Windows `vcm update` 1.0.5 → 1.0.6 in 37 s. `update_layers.py`: backend
  1.0.6-cuda 0 of 14 layers (0 of 2291.2 MB); frontend 1.0.6 4 of 10
  layers, 6.1 of 54.4 MB (#10 is forwarded-for.js). Frontend runs
  `node -r ./forwarded-for.js server.js`.
- After: VCM_VERSION and API 1.0.6, alembic b4e7c2d91a36, counts
  31/505/93, caption md5, video list and media checksum identical.
- Guard at localhost and 127.0.0.1: another port's Origin, cross-site,
  rebinding Host (POST and GET) 403; own origin passes.
- The fix, live: forged X-Forwarded-For from the host recorded 172.19.0.1
  (vcm_default gateway), from the worker 172.19.0.7 (the worker). The only
  forged values in audit.log are the two v1.0.5 test entries from before
  the update. `flow.js` at both hosts 7/7 PASS, 0 refused; its DELETEs and
  PATCHes recorded client 172.19.0.1.
- No E2E (pipeline unchanged); 4 throwaway videos made with e2e.py for the
  UI flow, all deleted. No clean-machine CPU run: frontend-only release,
  the frontend image is the same for both variants, and the CPU backend
  changed no layers.
- Secrets: nothing forbidden in git history; images hold only public CA
  bundles (certifi, pip, grpc), empty extra-CA dirs; frontend /app adds
  only forwarded-for.js.
- Left as asked: install running on 3000, dev stack stopped.

## v1.1.1: security, safety and legal (released 2026-10-27, tag on 115afa7)
Brief (Tanush, 2026-10-27): phase 2 of docs/LAUNCH_AUDIT.md, first release.
Then v1.2.0 (Next 15.5, long videos, virtual caption list, CLS, weekly
check, `vcm doctor`, model mirror). Published contact: GitHub only (issues,
private security reporting), no email.

- [x] **S2 FFmpeg allow-list** (8534237, 4960af1): protocol, format and codec
      whitelists on every run on a user's file, streams mapped by index,
      listed from headers only (`ffprobe -nofind_stream_info`). Tanush's
      decision for cover art / picture subtitles: never decode them, accept
      the video with the note "This file's cover image / picture subtitles
      were ignored.", thumbnail from the main stream, refuse a file whose
      only picture is a cover image. Duration from headers, or a packet scan
      (no decoding) when headers have none (browser WebM). 21 tests.
- [x] **S1 quick part + headers** (e851ed9, 1bcde28, ff82f8e):
      `images.unoptimized`, `/_next/image` 404; middleware guard (Host, and
      cross-site/same-site only as a top-level GET navigation); CSP with
      `frame-ancestors 'none'`, XFO, nosniff (frontend and API),
      `Referrer-Policy: same-origin` (no-referrer makes the app's own writes
      send `Origin: null`, which the guard refuses; checked in a browser:
      PATCH and DELETE pass), Permissions-Policy. ui-check `framing`,
      `frontend-guard`, `csp` pass on dev and on the production build.
- [x] **Non-root** (59458b3): `vcm` uid 10001, entrypoint hands the volumes
      over and `setpriv`s; compose `no-new-privileges`, `cap_drop: ALL` +
      5 caps for the root step. Upgrade test on throwaway project `vcmupg`
      (port 3005, 1.1.0 → local 1.1.1 CUDA build): 84 root-owned files
      handed to vcm, `CapEff 0`, old video streams and its export downloads,
      models not re-downloaded (552 MB), test CA trusted in both bundles, new
      GPU transcription, new Google font and NVENC export as vcm, search
      offline. Test videos 1 and 2 deleted by id, project removed with
      `down -v`.
- [x] **Pruning** (545b706): label-filtered `docker image prune` in `vcm` and
      `vcm.ps1`; checked read-only that the filter selects only images with
      this repo's label (a host-wide prune test was rightly refused). It also
      selects dangling *dev* builds of this app (same label).
- [x] **Search offline** (2a47fe1): MiniLM through `model_store`, pinned
      `1110a243`, falling back to an older version's cached copy; loads with
      `--network none`.
- [x] **emSign** (59458b3): disabled in `/etc/ca-certificates.conf`, certifi
      linked to the system bundle; 0 emSign certs in either. No Python layer
      rebuild.
- [x] **Actions pinned** (56f0d87): 16 `uses:` at full SHAs, `# vX.Y.Z`.
      Workflow `permissions:` were not changed (not in the brief; audit S7).
- [x] **L1** (8f33e0f, c63a1b2): `THIRD_PARTY_NOTICES.md` from
      `scripts/third_party_notices.py`; `/licenses` in both images (Python
      138, npm 38, Node, fonts, Python runtime, `SOURCES-debian.txt` with 219
      source packages and snapshot.debian.org links, all sampled links 200;
      `SOURCES-alpine.txt`). Frontend needs `--build-context repo=.`.
- [x] **L2/L3/L4 + SEO** (8688654, a03a61f, 7a4f06a, 7fc110b): PRIVACY.md,
      `site/privacy.html`, Gemini terms in Settings and README, warranty and
      rights lines, `og.png`, apple-touch-icon, canonical/OG/Twitter, JSON-LD,
      sitemap. Site checks: axe 0, no overflow, no outside requests, no CSP
      errors, both pages, 375/1440, light/dark. robots.txt still needs the
      root repo (audit SEO3, Tanush's call).
- [x] **Error messages** (9cb270c, ff1c97a, 99f9d0b).
- [x] Docs (af893e1, 4ec9f0e): SECURITY §3a/§5a/§6/§7/§8, API, PRD,
      ARCHITECTURE, TESTING, DATABASE, CHANGELOG 1.1.1.
- [x] Checks: ruff; backend 563 passed, 1 skipped; frontend lint, types,
      7 tests; images built (CUDA backend, frontend runtime); axe 0 on
      dashboard, search, settings, editor; shoot.js ok; E2E on the dev stack
      (GPU) all six languages passed: dev videos 7617-7622 deleted by id,
      7426 (not ours) left.
- [x] CI fix (115afa7): the first push failed CI's ruff step. The lint ran
      through the entrypoint, so as `vcm`, which can't write `.ruff_cache`
      into the runner's checkout; now `--no-cache`. Reproduced first, then
      ruff and pytest (564 passed) run as `vcm` on a runner-owned copy.
- [x] Released 2026-10-27: tag v1.1.1 on 115afa7; `release.yml` 4/4 green;
      8 assets match `SHA256SUMS`; anonymous manifest fetches 200.

### v1.1.1 released and measured (2026-10-28)
- Backup before `vcm update` (DATABASE.md §7, file ownership changes):
  `C:\Users\Admin\vcm-backup-pre-1.1.1-2026-10-28` (dump, media 28 files,
  `.env` copied unread). Kept until Tanush confirms.
- Update download: new layers 0.6 MB per backend variant, 7.1 MB frontend
  (manifest diff 1.1.0 → 1.1.1). `vcm update` took 25 s.
- Windows GPU install: `VCM_VERSION` 1.1.1, alembic at head, data unchanged
  (1 video, 159 captions, 5 exports); backend and worker uid 10001,
  `CapEff 0`, `NoNewPrivs 1`, nothing in the volumes left un-owned;
  `/licenses` in all three containers; 0 emSign certs; installed compose and
  `vcm.ps1` identical to the release.
- CPU upgrade (throwaway project `vcmcpu`, port 3006, no GPU override):
  1.1.0 install, one video + SRT + MP4 export as root; update to 1.1.1;
  85 files handed to vcm, the old video streams and its exports download,
  no model re-downloaded, new transcription and MP4 export as vcm. Videos
  1 and 2 deleted by id; project removed with `down -v`.
- Guard probes on the install: own origin at localhost and 127.0.0.1 200;
  other origin, cross-site and rebinding Host 403; `/_next/image` 404;
  headers on pages and API. `checks.js framing frontend-guard csp` pass.
- E2E on the GPU install (same, en, fr; 40 s clip): all exports downloaded.
  `flow.js` at localhost and 127.0.0.1 all PASS, speech model back on auto.
  Videos 107, 108 (deleted by flow.js) and 109 (API) gone; 84 (Tanush's)
  remains.
- Secrets: none in git history or either image; extra-CA and storage dirs
  empty.
- Found: pip's vendored certifi (build-time only) and grpcio's built-in
  `roots.pem` (from chromadb's OpenTelemetry exporter) still list the emSign
  roots. The app's own TLS (ssl default, certifi) has 0. Raised with Tanush.
- Live site: both pages, og.png, apple-touch-icon, sitemap 200; tags in place.

### Added to v1.2.0 (Tanush, 2026-10-28)
- S7: least-privilege `permissions:` in every workflow.
- Skipped: robots.txt (SEO3); it needs a separate root repo, small gain.

## v1.2.0 (released 2026-10-29, tag on 5eebc6d)
Brief: the phase-2 list above (Next 15.5, long videos, virtual caption list,
CLS, weekly check, `vcm doctor`, model mirror, S7), with three items from
Tanush's testing first (2026-10-28).

- [x] **Item 3, SRT on one line** (91a078d, 4e1123b): not an export bug. The
      install's log: Reset on video 84 at 08:35:18 UTC, 4 s after the last
      style save; the SRT at 08:35:36 used the reset defaults (Balanced). The
      two-line MP4s were exports 179-183, made before. Reproduced on dev:
      Stacked 3 → SRT/VTT = the burn line for line; Reset in one editor shows
      the defaults at once. Tanush's choice: tests + a safer Reset. Test:
      SRT and VTT = the burn's lines cue for cue for Balanced, Auto, Stacked 1
      and 3, manual breaks, style changed before each export (fails when the
      sidecar ignores the style, checked). Undo for 10 s after Reset; the
      style is read again when a tab regains focus.
- [x] **Item 1, font feedback** (351f27e, 4e1123b, 9234bf9): the download happens on
      the font file's first GET, which ran `ensure()` on the event loop and
      held up every request (the style save's spinner by Reset was all that
      showed). Now in a thread (test fails before: 1.53 s, passes after). The
      Font field says "Downloading font… this can take a few seconds the
      first time." after 0.3 s and a plain failure message (role alert), ~190
      px below Reset. The style's `font_win_span` is taken from the server
      once the face arrives (that field only, if the font is unchanged).
      A message belongs to its font: a Reset or preset that swaps the font
      clears it (found by screenshot, fixed in 9234bf9).
- [x] **Item 2, alignment moves the caption** (d8ad077, b78ee88, b7c7372,
      fc8e7e1, b60c09a): Tanush's edge-anchor rule (D19). `pos_x` = the
      block's left edge / centre / right edge by alignment; the block is as
      wide as its longest line; an alignment change saves `anchorOf` the
      shown caption's block (the nearest one in a gap); Top/Middle/Bottom
      centre the shown caption; drag snaps the caption's centre; on Left/Right
      the width handles keep the anchored edge unless it is the one dragged.
      Migration `e8b3d5f19a42` (old box edge, NULL width by the file's frame
      shape). The old rule moved a caption up to 1091 px (80%) / 1350 px (94%)
      on 1080p; now 0. Byte-identical: 360 burns made by v1.1.1 before the
      change (`burn-1.1.1.json`, hashes) all match after migration; the 1.0.7
      golden test too.
- [x] **emSign, the last two copies** (Tanush, 2026-10-28): pip's vendored
      certifi in both Pythons linked to the system list, gRPC pointed at it
      (`GRPC_DEFAULT_SSL_ROOTS_FILE_PATH`), in a layer after `/licenses`.
      CPU image built from the release cache in 24 s (large layers cached).
      Checked: both links resolve; gRPC with a one-CA list refuses
      www.google.com, with the system list connects.
- [x] Cleanup after 1.1.1 (Tanush): CPU images `latest-cpu` and `1.1.0-cpu`
      and the `busybox:1.37.0` tag removed by name; the pre-1.1.1 backup
      folder deleted.
- [x] **S1: Next.js 15.5** (dbd5b4c, 67219f9, c8516e5, 632925b, then the
      upload commits): next 15.5.28, react/react-dom 19.2.9 (19.2 line, as
      Next 15.5 shipped against; 14 Oct patch), @types 19.2, eslint-config-next
      15.5.28; ESLint 8 kept (`next lint` warns it goes in 16). The two [id]
      pages read the id with `useParams`. sharp (Next 15's optional image
      library, LGPL libvips binary) removed before the build; notices
      regenerated. Production build clean; headers, guard probes, framing,
      frontend-guard, csp pass on dev and the built image; the forwarded-for
      hook checked with an echo backend.
      Full ui-check set on the built image (26 checks): 400 PASS, 0 FAIL; axe
      0 on 6 pages; shoot.js 4 pages x 2 widths x 2 themes; E2E (same, en)
      through the built image.
- [x] **Uploads bypass Next's proxy** (D20, Tanush's conditions): found
      that the upgrade capped uploads at 10 MB (the rewrite proxy, not only
      middleware, copies the body), and that Next 14 already held each upload
      in memory and Node cut uploads after 5 min. Route handler
      `app/api/videos/route.ts` (Node http, 30 min idle); middleware skips
      exactly `/api/videos` (the only route with a file field); preload sets
      X-Forwarded-Host from Host and `requestTimeout = 0`; API closes a
      dropped upload's temp file (`app/multipart.py`, Starlette closes it only
      on parse/disk errors). Measured: 2.05 GB in 9.8 s, frontend peak 79
      MiB; 360 MB at 1 MB/s in 358 s (1.1.0 frontend: cut off); browser
      Cancel at 360 MB: API request ended, 0 bytes held, no row or file.
      `upload-proxy` check: >10 MB whole, 4 guard probes 403 through the
      proxy, own request passes. Backend 605 passed; frontend 10 tests.
      Test videos 7625-7628, 7661-7667 (mine) deleted; 7426 left.
- [x] Checks for items 1-3 (dev stack, video 7623): backend suites touched
      (layout, line control, exports, styles, anchor, fonts) pass; the 8
      existing editor checks (drag, handle, keyboard, safe area, width, snap,
      line styles, layout parity) 199 PASS, 0 FAIL; `alignment-anchor` 38
      PASS (36 cases ≤0.5 px preview, ≤1 px burn; shared edges); axe 0 on
      dashboard, editor, settings, search, and on the editor with each new
      message (downloading, failed, Undo) in light/dark at 375/1440; browser
      script: download message, failure message, measured win span, Reset →
      Undo restores every field, a focused tab shows another tab's Reset.
- [x] **MP4 export "slow" (Tanush, 2026-10-29): it was a hang, from
      v1.0.0.** new.mp4 (15 min, 1080p30, Hindi, a YouTube download) was
      exported on the **install** (v1.1.1, CUDA image, h264_nvenc), not on
      dev: video 140, export started 18:57:28 UTC; the output stopped growing
      at 18:58, ffmpeg asleep with 90 s of CPU, GPU 0%, worker "unhealthy".
      Cause: stderr was a pipe read only after ffmpeg exited; this source's
      decoder prints "Late SEI is not implemented" (77 KB over the video), the
      64 KB pipe filled at ~80%, ffmpeg blocked, and the 3-hour timeout never
      started (it was a timeout on the wait after stdout closed). Stage times
      on this file, install GPU: decode 14 s, decode + libass 13 s, decode +
      NVENC 72 s, full 71 s (encoder-bound; captions cost nothing measurable).
      Same `burn_captions` from v1.1.0, v1.1.1 and the fix, same image and
      ffmpeg: 1.1.0 and 1.1.1 at 80% after 58 s and hung; the fix 72 s.
      Fix: stderr drained on a thread (last 40 lines kept for the error), the
      deadline a timer that kills ffmpeg, the command and the time/speed
      logged; x264 `faster` (D21; 4 cores, 120 s: medium 87 s, faster 51 s,
      veryfast 34 s). Measured: GPU dev stack through the app
      (`scripts/burn_time.py`): 76 s end to end, ffmpeg 72 s (12.4x); CPU
      only, 4 cores, whole video: 397 s (2.25x). Time left shown under the
      export bar (`useEta`); `export-eta` check PASS; axe 0, 375/1440 light
      and dark. Release checklist item 6. Tests: 3 new (all fail on 1.1.1);
      backend 608 passed. Test videos 7668 (by the script) and 7669 deleted;
      7426 left.
      Found, fixed next (Tanush: "they're small"): the export options asked
      the **API** whether NVENC works, and the API container has no GPU, so
      "GPU encoding." never showed; and the worker's health check pinged a
      `--pool=solo` worker that can't answer during a task, so any long job
      showed "unhealthy".
- [x] **Install cleanup (Tanush, 2026-10-29):** the hung export's 1.36 GB
      partial file deleted; then storage against the `exports` table: 19
      more files with no row (8 MP4, 11 SRT/VTT, ~43 MB, 2026-10-08 to 10-12,
      from the pre-v1.0.5 delete bug), deleted by name with Tanush's OK. Now
      2 rows, 2 files, none missing either way.
- [x] **"GPU encoding." from the worker:** the worker's hardware report
      (`worker_ready`) carries `nvenc`; `/exports/options` reads it, never
      probes in the API. Test: the API's own probe raises, the answer follows
      the report (true, false, absent). Live: dev report `nvenc: true`.
- [x] **Worker heartbeat:** a thread touches `/tmp/vcm-worker-heartbeat`
      every 15 s after a Redis ping; `worker_init` clears it; the prod health
      check passes while it is under a minute old. Measured on the GPU dev
      stack through a 15-minute transcription and burn (video 7670, deleted):
      heartbeat healthy at every 8 s poll, `celery inspect ping` no answer
      throughout. `vcm update`/`restart`/`start` wait only for `/api/health`,
      nothing `depends_on` the worker's health and Docker restarts nothing for
      it: an unhealthy worker never made `update` wait or restart it. `update`
      does restart a busy worker when its image changes; recovery requeues the
      job (unchanged). Tests: 3 heartbeat + 1 encoder; backend 612 passed.
- [x] Checked while testing: transcribing new.mp4 with the language on
      automatic (Devanagari, large-v3) takes 395 s on the 1.1.1 install and
      425-466 s on dev, 286-310 segments, against 75 s for Tanush's export of
      it in Roman script (the Hinglish model). Not a regression: same code,
      libraries and model files. Test video 141 (install) deleted.
- [x] **Before tagging 1.2.0:** backend 612 passed, 1 skipped, ruff clean;
      frontend lint, types, 10 tests; `docker build --target build frontend`
      clean (`/api/videos` a dynamic route). E2E on the GPU dev stack
      (hinglish.mp4, same and en, SRT, VTT, MP4): ALL PASSED; on the CPU path
      (same images, no GPU: large-v3-turbo int8, libx264 `faster`, burn 20 s
      at 11.3x on 32 cores): ALL PASSED. Test videos 7671-7673 deleted; 7426
      left. Notices unchanged since the Next commit (no dependency or base
      image change after it).
- Scope (Tanush, 2026-10-29): release v1.2.0 with what is done. Long-video
  phrasing and honest progress, the virtualised caption list, CLS, the
  weekly workflow, `vcm doctor` with the issue template, S7, and the model
  mirror move to the next version.
- [x] **Released and checked (2026-10-29).** CI and `release` green on
      5eebc6d (images: backend cpu and cuda, frontend; release); 8 assets,
      each matching `SHA256SUMS` and the tag; all six GHCR tags pull
      anonymously.
      - Backup before the update (DATABASE.md §7, tar by the install's own
        image): `C:\Users\Admin\AppData\Local\VideoCaptionMaker-backup-1.1.1`,
        `vcm.dump` (all 7 tables), `vcm-media.tgz` (9 of 9 files), `.env`
        copied unread; 14 s down. Kept until Tanush confirms.
      - `vcm update` in 47 s: backend 9/19 layers, 0.5 MB; frontend 7/13,
        11.0 MB. Version 1.2.0; alembic head `e8b3d5f19a42`; videos 84 and
        140, 674 captions, 2 exports, 2 styles, all as before.
      - Images: backend and worker uid 10001, frontend uid 100, CapEff 0,
        NoNewPrivs 1; `/licenses` complete; pip's certifi links to the
        system list, `GRPC_DEFAULT_SSL_ROOTS_FILE_PATH` set; no sharp;
        Next 15.5.28.
      - At localhost:3000 and 127.0.0.1:3000: framing, frontend-guard, csp,
        `upload-proxy` (62 MB upload whole; 4 probes 403 on /api/videos;
        own request passes), `export-eta`: 40 PASS, 0 FAIL. `flow.js`:
        delete, settings and back, SRT and MP4 export, nothing refused: PASS
        at both. "GPU encoding." shows in the export panel
        (`hardware_encoder: h264_nvenc`).
      - E2E on the install (same, en, hi, fr; SRT, VTT, MP4): ALL PASSED.
      - Large upload: 2,209,733,837 bytes, held, in 10.4 s, stored whole
        (owner vcm); frontend 62 → 111 MiB peak.
      - `burn_time.py`, new.mp4 (15 min, 1080p, a YouTube download): 74 s
        end to end, ffmpeg 72 s (12.5x) with h264_nvenc; the worker healthy
        at all 56 samples over 9.5 min (464 s transcription and the burn);
        `vcm status`: all six healthy.
      - Secrets: none in git history (`docs/learning-guide.md` was committed
        and removed on 2026-08-06; no secret in it); none in the images (the
        extra-CA folder in the running backend is the install's own
        `proxy-root.crt` mount; the image has none).
      - Test videos on the install: 141-152 (mine), all deleted; videos 84
        and 140 remain. Scratch files, the extra `1.2.0-cuda` tag and test
        containers removed. Not done this time: a Linux/CPU install (none
        here; the CPU path was covered by E2E before tagging).

## v1.2.1 (in progress)
Brief (Tanush, 2026-10-29): the (i) button (brief to come), and "nan nan
nan" captions in music sections: test-assets/new.mp4 (15-min Hinglish vlog,
gitignored) and Tanush's export new.srt, 33 of 515 captions only "nan".

- [x] **Music captions** (dev stack, GPU):
      - Cause: only the Hinglish model (Apex) says "nan" (large-v3 never).
        Over music each "nan" has word probability 0.80-0.98, avg logprob
        -0.3 to -0.6, no-speech probability 0.00 and, a word to a segment,
        compression ratio 0.27: Whisper skips a window only when no-speech
        > 0.6 *and* logprob < -1.0, the ratio check needs > 2.4, and the
        silence check can't see music. "nan" is NaN as text: the model's
        training data's missing transcripts. Isolated, Apex said nothing
        over 14.5-27.2 s; the runs come from `_fill_skipped` decoding the
        gap alone.
      - large-v3 has its own: over music it writes "कर दो", "करते हैं",
        "हुआ है" (22 of its 25 segments there), at no-speech 0.56-0.90 and
        logprob -0.23 to -0.58. Scores alone don't separate them from speech
        (any cut that drops most of them drops 6-23 speech segments).
      - Fix (`_speech_runs`): Apex's "nan" runs cut out of each segment,
        the speech either side timed to its own words; a large-v3 segment
        that is only that filler, at no-speech >= 0.5, is music. Both kept
        as `non_speech` segments through `_fill_skipped`, then removed. A
        first version dropped them at once and lost "log yaad karo
        bhaiyon…" (806 s), found only by re-decoding the shorter stretches
        between the "nan" runs.
      - Apex, before (7674, old code) → after (7680): `music_check.py`
        56 failures → 0; "nan" words 275 (Tanush's export) → 0; captions
        513 → 474; "khelta jaoon ×4" and "nahin. Nahin. Nahin." kept.
        Coverage: every newly uncaptioned stretch (22) is where only "nan"
        was; none elsewhere. Real words against the export: 3208 vs 3191
        (an earlier fixed run, 7678: 3208 vs 3208); the differences are all
        in 486-539 s, which Apex decodes differently run to run (the old
        code's run 7674 differs from the export there too).
      - large-v3, before (7676) → after (7679): music captioned 48.8 → 15.4
        of 64 s. Recording every raw segment of a final-code run: the rule
        flagged 33, 16 over music and 17 where large-v3's phrase was not
        what was said (Apex heard other words or nothing); none of the
        coverage changes came from it (large-v3 alone varies 8-24 uncaptioned
        stretches between runs). One filler under the 0.5 guard kept.
      - Not changed: large-v3 repetition loops over real Hinglish speech
        ("सब्सक्राइब ×3" where Apex hears "nahin aati na…", "डिलीशियर ×3",
        "एक एक एक एक समोसा"); not music, so not this fix. Raised with Tanush.
      - Tests: 8 in `test_transcription.py` (the nan, mixed and filler ones
        fail on the old code; the khelta, same-words and English "nan" ones
        guard real speech). Backend 622 passed. `backend/scripts/
        music_check.py`. Test videos 7674-7680 deleted.

## Website on GitHub Pages (2026-10-27)
Brief (Tanush): a landing page separate from the app, on GitHub Pages, from
facts in README, PRD and LANGUAGE_QUALITY.md only; the app's design system;
plain HTML and CSS in `site/`, a few lines of JS; no frameworks, trackers or
external fonts or scripts; axe 0; a Pages workflow for pushes to main that
change `site/`.

- [x] `site/`: index.html, style.css (the DESIGN_SYSTEM.md tokens, light and
      dark from the OS), main.js (copy buttons; Linux preselected on Linux
      and macOS), favicon.svg, and the four v1.1.0 screenshots from
      docs/images as WebP (1.2 MB of PNG → 256 KB). The Windows/Linux
      toggle is two radio buttons switched with CSS `:has()`, so it works
      without JS. A Content-Security-Policy allows only the site's own
      files.
- [x] Checked at 375 and 1440 px, light and dark (served locally on 8090):
      axe 0 (WCAG 2.1 A/AA), no horizontal overflow, no request outside the
      site, no console errors; the toggle by click and arrow keys; Copy puts
      the command on the clipboard and says "Copied".
- [x] `.github/workflows/pages.yml`: configure-pages, upload-pages-artifact
      (site/), deploy-pages; on pushes to main touching `site/**` or the
      workflow, and by hand.
- [x] README: the site link; image links fixed to the files' capitalised
      names (lowercase links break on GitHub); "about 7 MB" a typical
      update (measured 7.2–7.4 MB for 1.0.7 to 1.1.0).
- [x] Deployed: the pages run for a7e5f35 passed; the live site serves every
      file.
- [x] LICENSE: MIT, "Copyright (c) 2026 Tanush Thakran" (Tanush's choice).
      README and the site footer say the code is MIT, and the model list
      adds Oriserve/Whisper-Hindi2Hinglish-Apex (Apache-2.0) and IndicXlit
      (MIT), both downloaded for Hinglish (licences checked on their
      Hugging Face pages).
- [x] GoatCounter (Tanush's request; it replaces the brief's "no trackers"
      on the site only, never the app): page views, plus events for Copy
      (`copy-windows`, `copy-linux`) and the toggle (`os-windows`,
      `os-linux`) from `data-goatcounter-click` attributes, so main.js is
      unchanged. count.v5.js pinned with an SRI hash. CSP adds only
      `script-src https://gc.zgo.at`, `connect-src` and `img-src
      https://vcm.goatcounter.com` (sendBeacon, image fallback). Footer:
      "Anonymous visit counts via GoatCounter; no cookies."
- [x] Checked as before, plus: no CSP violations; one view per load; the
      four events on click (an arrow key on the toggle counts too; the
      Linux preselect doesn't). Run on a test host name with
      vcm.goatcounter.com mapped to this machine and answered locally, so
      no test hit reached the real stats.
- Decisions: Search shown instead of an Export screenshot (docs/images has
  none; Tanush: keep it); the command is in monospace (code, not UI text).

## v1.1.0 (in progress): minimal, Apple-like redesign
Brief (Tanush, 2026-10-23): restyle only (hooks, API calls, state, data
flow and behaviour unchanged) to a minimal, Apple-like look: hierarchy from
type and spacing, not boxes; one accent (#0071E3 / #0A84FF) for the one
primary action, selection and progress; system font stack; mono only for
timecodes; hairline separators; translucent bars; exact tokens in the brief
(also in DESIGN_SYSTEM.md once written). design/stitch/ is no longer the
reference. Dev stack on 3001 only.

Process:
1. Tokens, Dashboard and Editor in light and dark; screenshots at 1440 and
   375 px; **stop for Tanush's OK** (one checkpoint).
2. After the OK, one commit per screen: language step, processing, failed,
   export dialog, search, settings, empty states, notices, 404.
3. All checks (lint, types, production build, npm test, ui-checks, axe 0,
   E2E), DESIGN_SYSTEM.md replaced, CHANGELOG v1.1.0, final screenshots,
   release steps; after the tag: backup, checklist, update, verify.

### Status
- [x] Phase 1 built (2026-10-23): tokens (globals.css, tailwind.config.ts:
      colours, type scale on Tailwind's own names, radii, system fonts),
      primitives (button, dialog, input, select, badge, skeleton, slider,
      new Menu and Segmented), header, Dashboard, Editor. lint, tsc and
      npm test clean; ui-checks 316 PASS on the dev stack (3001) with test
      video 7611 (to delete at the end); the 4 axe failures are on the
      language step, restyled in phase 2. Screenshots sent; **waiting for
      Tanush's OK** before phase 2.
- [x] Phase 1 review (Tanush, 2026-10-26): direction right, the 8 decisions
      accepted; 11 notes applied (round 2): upload area 140 px with an icon
      and "Drop a video here, or choose one. Everything runs on this
      computer."; stats "6 videos · 1.2 GB" (footage, captions, queue and
      free disk moved to Settings → Storage); footer "VideoCaptionMaker
      v1.x.x" (new `version` in `/api/system`); one quiet player row (time;
      previous, play, next; volume and speed popovers; no resolution, no
      6-button speed); dense caption list (~8 rows at 1440: 12 px mono time,
      15 px text, hairlines, current row on the grouped tint with an accent
      time); no scroll slider under the timeline (the view follows the
      playhead; a horizontal swipe or Shift+wheel pans), a 2 px accent
      playhead with a head; caption handles 3 px and the drag dot shown only
      while hovered, focused or dragged; the two helper lines become hints
      shown once (localStorage); the phone's bottom tab bar kept, the
      editor's sheet as it was. Screenshots sent; **waiting for OK**.
- [x] OK for phase 1 (Tanush, 2026-10-26), with two phone-editor fixes for
      phase 2: a "peek" state on the sheet with the current caption
      (time and text, editable on tap), and no app header in the editor on
      a phone.
- [x] Phase 2 (2026-10-26), one commit per screen: language step
      (6a7f810, new `Notice`), processing (13b30bc), failed (d845290),
      notices (0976b63), dark accent text token (ff62a99), export dialog
      (fcc286d), primary hover token (675e5ad), search (ad3fbdf), settings
      (d028e75), empty states (f2519f1), 404 and error pages (763fb4b), the
      phone editor fixes (971c876), last monospace and unused Card /
      EngineChip (5149d43). Every state shot and axe-scanned at 375 and
      1440, light and dark: axe 0 everywhere (the language step's 4 and
      /settings' 2 failures fixed).
- [x] Final checks (2026-10-26, dev stack on 3001): lint and tsc clean;
      npm test 3/3; production build (`docker build --target build`) OK,
      image removed; ui-checks **352 PASS, 0 FAIL** (all 22 checks); axe 0
      on all 112 final shots (28 screens and states × 375/1440 × light/dark)
      and on /dashboard, /search, /settings; no horizontal overflow; E2E
      `flow.js` at localhost:3001 all PASS (delete via "…", speech model
      small → auto, SRT and burned MP4 exported and downloaded, nothing
      refused by the guard). Throwaway videos 7612 (deleted by the flow) and
      7613; 7611 (from phase 1) and 7613 deleted through the API afterwards.
      DESIGN_SYSTEM.md replaced; CHANGELOG v1.1.0. No migration (head
      `b6e0f4a9c2d1`). Release steps sent.
- [x] Final review (Tanush, 2026-10-26), 5 fixes:
      1. "Hindi captions in" as the caption-language tiles (radio, accent
         outline when chosen); Start still waits for a choice (19d8c9b).
      2. Export resolutions only up to the source, never an upscale; the
         default is the source (cap 2160); a larger height is a 422; tests
         (4ba532c, 98986f2). Reverses the earlier "upscale to rescue small
         captions" default (PRD and API.md updated).
      3. **Medium removed** rather than documented (ae6ce74, e6b7ae4,
         28ff525): it is the size of large-v3-turbo (1.53 vs 1.62 GB),
         slower, measured worse on Hindi (DECISIONS), and no tier picks it,
         so no machine is better served by it. A stored `medium` reads as
         `auto`; `WHISPER_MODEL_SIZE=medium` still works by hand. Settings
         gains a Hinglish (Apex) row, downloaded or not and 1.6 GB, from a
         new `hinglish_model` in `/api/system`; tests for both.
      4. The stepper is Upload, Language, Captions, Export; Captions is
         current while processing and on the failed view (f64690f).
      5. During a Redo: "Showing the previous captions until the new ones
         are ready." above the list (d6c38dd).
      Checks after: ruff; pytest 538 passed, 1 skipped; npm test 3/3;
      production build; ui-checks 352 PASS; axe 0 on the 4 review screens
      in both themes and widths; E2E flow all PASS. Test videos 7615 and
      7616 created and deleted (7426, not ours, remains). Release steps
      sent.
- [x] Released (2026-10-27): Tanush pushed `main` and tagged v1.1.0 on
      d252f06.

### Release check (2026-10-27)
- CI green on d252f06 (frontend, backend, scripts); `release.yml` green
  (images backend cpu and cuda, frontend; release). 8 assets, all 7 match
  SHA256SUMS; 1.1.0-cuda, 1.1.0-cpu, latest-cuda, latest-cpu and frontend
  1.1.0/latest fetch anonymously (200).
- Backup per DATABASE.md §7 (24 s downtime):
  `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.1.0` (vcm.dump 32 KB,
  all 7 tables; vcm-media.tgz 284 MB, 28 files as on the volume; .env copy;
  rowcounts 1 video, 159 captions, 5 exports, 1 style, caption md5).
  `pre-1.0.11` kept (Tanush hasn't asked to delete it).
- `vcm update` (Windows GPU) in 24 s: the API reports 1.1.0, alembic
  `b6e0f4a9c2d1` (head, no migration); rows and caption md5 unchanged;
  `/api/system` serves the three speech models and `hinglish_model`
  (downloaded). Download **7.2 MB**: backend CUDA 3/15 layers, 0.2 MB;
  frontend 4/10, 7.0 MB.
- Guard (POST): own origin passes at localhost and 127.0.0.1 (422, no
  file); another port, another origin, cross-site and a rebinding Host 403.
  `flow.js` 7/7 PASS at both addresses (delete via "…", speech model small
  and back, SRT and a 1080p burned MP4), nothing refused.
- `scripts/e2e.py` not run: transcription and translation are unchanged;
  the export change (heights up to the source) is covered by `flow.js`'s
  MP4 at the new default and by the backend tests.
- Test videos 101-104 on the install (101, 103 deleted by `flow.js`; 102,
  104 by `DELETE /api/videos/{id}`); it holds video 84 only, speech model
  back on Automatic.
- Secrets: no forbidden path or key pattern in the v1.1.0 commits; the
  images hold only the distro CA bundle and an empty extra-CA dir. The
  1.1.0 tags pulled for the check were removed (layers shared with latest).

### Phase 2 decisions (taken under the brief; listed for Tanush)
- **Dark accent text #409CFF**, not #0A84FF: #0A84FF text is 3.8:1 on the
  #2C2C2E groups inside a dialog. Fills, rings and selection stay #0A84FF
  (same reasoning as light's #0066CC).
- **Primary hover darkens** (#0062C4) instead of fading to 90 %, which put
  white text at 4.1:1 while hovered.
- **One primary per screen:** the editor bar's Export is grey until the
  video has captions (processing, failed: the page's own action is the
  primary); the search preview's "Open in the caption editor" is grey
  (Search is the primary).
- **Peek:** the lowered phone sheet sits in the page after the timeline,
  fills the rest of the screen and sticks to the bottom edge, so there is
  no gap on a tall phone and no overlap on a short one (667 px: a 28 px
  scroll). The caption is edited in the peek itself (a tap opens the
  keyboard there, with the video still in view; the same autosave as a
  list row, and it holds the caption being edited while the playhead moves
  on). Raising the sheet to focus the list row instead would not open a
  phone keyboard (focus outside the tap).
- **Settings** title "Settings" (was "Settings & hardware"); Your computer
  lists acceleration, graphics or processor, memory and the model in use as
  rows (all from `/api/system`); the Gemini key has its own group, with
  Remove key as red text in the Key row.
- **Export resolution** on the segmented control, "Recommended: 1080p." in
  the note under it rather than a word inside each segment.
- **Removed dead code:** `ui/card.tsx` and `layout/engine-chip.tsx` (no
  callers left).
- **Accounts-mode screens** (landing, sign-in, user menu) still tokens only.

### Decisions (taken under the brief; listed for Tanush)
- **AA over exact colour where they conflict:** the brief's colours are
  used exactly for fills, dots, rings and progress; text uses AA twins:
  accent text #0066CC (light), the filled primary in dark #0071E3 (white
  on #0A84FF is 3.6:1), red text #D70015 / #FF453A and the filled red
  #D70015, warning text #C93400. Status is a dot beside ordinary text.
- **Segmented controls:** labels in the main text colour in every segment
  (#6E6E73 on the #E8E8ED track is 4.15:1); the selected segment is white
  (dark #636366).
- **Kept, restyled, not removed** (restyle only): the stats (now one grey
  line under "Videos"), the list view, the name filter, the timeline zoom.
- **Header:** "Videos, Search, Settings" (was "Projects"); the hardware and
  address chips and the theme toggle left the header (the theme is in
  Settings; hardware goes to Settings in phase 2). The footer line stays,
  as quiet sans text.
- **Card actions** behind "…" (Open, Search this video, Try again / Start
  now, Settings, Delete…); delete confirms in a dialog, the only filled red
  button. `flow.js` follows (menu, then the dialog).
- **Editor:** inspector = one segmented control, Captions · Typography ·
  Appearance · Position (the style checks' tab names and radio roles
  kept); one StylePanel shared by the three style tabs; the timeline spans
  the width under stage and inspector; the play button is a plain icon
  (Export is the one primary). On a phone the inspector is a bottom sheet,
  raised by a tab or its grabber. `caption-snap` picks a style tab after
  its reload (the inspector opens on Captions).
- **No webfont for the UI:** Geist and JetBrains Mono dropped for the
  system stack and the system monospace; caption fonts untouched.
- **Accounts-mode screens** (landing, sign-in), not shipped: tokens only.

## v1.0.11 (released 2026-10-23, tag on 6094524): quiet recordings, nine languages
Brief (Tanush, 2026-10-22/23): fix quiet recordings (found by the language
eval) and say "No speech was found in this video." when a job still ends
empty; remove Tamil, Marathi, Bengali and Malayalam instead of marking them
Beta, warn about speech in a language not offered with "pick the spoken
language" or "Try anyway" (neither preset; "Try anyway" + "Same as spoken"
kept, with the video-page note); existing videos keep working; README,
PRD, CHANGELOG, ROADMAP and eval docs; tests.

### Done
- [x] Quiet recordings (`services/transcription.py`, `silence_for`): -40 dB
      as before unless more than half of the voiced envelope windows fall
      inside that silence, then 15 dB under the speaking level, floor -80.
      FLEURS large-v3: English 58.6 → 5.7% WER (27 empty clips → 0), French
      6.9 → 5.5%; Spanish, Portuguese, Italian, Russian, German, Dutch the
      same text line for line; Hindi 26.4 → 25.7% (run-to-run variation).
      The first version (lower the threshold whenever the speaking level
      was quiet) kept an invented "Vielen Dank." on two German clips: caught
      by the re-measure, replaced, and covered by a test.
- [x] A job with no captions completes with "No speech was found in this
      video." (`NO_SPEECH_NOTICE`), shown once on the video page.
- [x] Languages: `LANGUAGES` is nine; `RETIRED` names bn/mr/ta/ml. API
      validation refuses them as caption or spoken language (422). The
      language step warns about any detected language not offered
      ("Tamil speech isn't supported yet, so captions would be
      inaccurate."), with a spoken-language picker or "Try anyway (low
      quality)", neither preset, Start held; Hindi chosen asks how it's
      written. The Marathi answer to the Hindi question is gone. The video
      page notes captions from unsupported speech; existing videos keep
      their names, captions and exports, and their Redo asks for an
      offered language. Fonts kept.
- [x] Tests: `test_languages_offered.py` (11) and 5 in
      `test_transcription.py`; 14 of them fail on v1.0.10, the 3 that pass
      there guard what must not change (Try anyway accepted, an old Tamil
      video opens and exports, a silent track stays silent). New
      `checks.js unsupported-speech` (28) and `retired-language`;
      `editor-languages`, `language-step`, `hindi-script` updated.
- [x] Backend 536 passed, 1 skipped (after the rule refinement);
      ruff, frontend lint, type-check and tests clean; ui-checks
      `editor-languages language-step unsupported-speech retired-language
      redo-script hindi-script script-fonts` all PASS on the dev stack
      (3001). Screenshots of the notice at 375/1440, light and dark.
- [x] Real Tamil video 7600, made on v1.0.10 in the dev stack: on v1.0.11
      it opens, reads "Auto-detect → Tamil", shows the note, its Redo asks
      for a language, and exports SRT and a burned MP4 drawn in Noto Sans
      Tamil.
- [x] Pipeline on v1.0.11 (videos 7601-7610, deleted by id): the same
      captions, gaps and timing results as on v1.0.10 for all nine.
- [x] Docs: README (no more "Same as spoken works for any language"), PRD,
      ARCHITECTURE, API, SECURITY, TESTING, DECISIONS D18, ROADMAP (re-add
      the four with Indian-language models, with the numbers), CHANGELOG,
      LANGUAGE_QUALITY ("After the fix").

### Known, not changed
- A recording mixing a loud and a very quiet speaker can still lose the
  quiet one (the joined English pipeline clip loses 7 of 17 utterances).
- Captions under 0.8 s where a 0.5 s pause follows ("है गाइस", 0.60 s, on
  the install's E2E); words heard but uncaptioned in loud German (1.9 s) and
  English in the FLEURS pipeline runs.

### Release check (2026-10-23)
- Tag v1.0.11 on 6094524; CI and `release.yml` green on it; 8 assets, all 7
  match SHA256SUMS; 1.0.11-cuda, 1.0.11-cpu, latest-cuda and frontend
  1.0.11/latest fetch anonymously (200).
- Backup per DATABASE.md §7 (29 s downtime; busybox:1.37 already present):
  `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.0.11` (vcm.dump 32 KB,
  all 7 tables; vcm-media.tgz 284 MB, 28 files as on the volume; .env
  copy; rowcounts 1 video, 159 captions, 5 exports, 1 style, caption md5).
  `pre-1.0.10` deleted after the update was verified, as Tanush asked.
- `vcm update` (Windows GPU) in 35 s: the API reports 1.0.11, alembic
  `b6e0f4a9c2d1` (head, no migration); rows and caption md5 unchanged; the
  API serves the nine languages. Download **7.4 MB**: backend CUDA 3/15
  layers, 0.2 MB; frontend 4/10, 7.2 MB.
- Guard (POST): own origin passes at localhost and 127.0.0.1 (422, no
  file); another port, another origin, cross-site and a rebinding Host 403.
  `flow.js` 7/7 PASS at both addresses, nothing refused.
- E2E on the install: `hinglish.mp4` same (125 captions), en (126), es
  (138), SRT, VTT and MP4 each, ALL PASSED; a copy 40 dB quieter (peak
  -39.9 dB) gave 131 captions ("A quiet recording: silence is under
  -80.0 dB" in the log), `coverage_check.py` PASS. On the normal copy
  large-v3 left 204.06-205.06 s uncaptioned (decoded 200.7-204.0 s as "है
  गाइस किया"), where v1.0.10's E2E had none: run-to-run variation in the
  decode (the silence rule leaves that file alone), added to the ROADMAP
  item. The quiet copy had one 0.54 s caption (the other ROADMAP item).
- Test videos 97-100 deleted (98, 99 by `flow.js`; 97, 100 by
  `DELETE /api/videos/{id}`); the install holds video 84 only. Check
  scripts copied into the worker's /tmp for the run, then removed.
- Secrets: nothing forbidden in the v1.0.11 commits; the images hold only
  public CA bundles (grpc's roots.pem).
- ROADMAP: "Captions under 0.8 s before a 0.5 s pause" and "Loud speech
  left without a caption (1-2 s)", with their numbers (Tanush: later).
- Dev stack stopped afterwards (`docker compose stop`).

## Language quality eval (done 2026-10-23), then v1.0.10 install, then v1.0.11

Resumed 2026-10-23: the CPU runs finished (kept languages only, 38 min),
the pipeline ran (videos 7590-7599, all deleted by id; the dev stack holds
only 7426, not ours), and the report is
[docs/LANGUAGE_QUALITY.md](docs/LANGUAGE_QUALITY.md), summarised in
TESTING.md ("Language quality") and the PRD's known limitations. Found
besides the quiet-recording bug, not changed: 8 captions under 0.8 s
across 6 of 10 pipeline runs (clips with 0.6 s pauses), and words heard
but uncaptioned in loud German (1.9 s) and English, and 0.84 s of
Portuguese.

Where it stood when paused the night before:

Stopped for the night at Tanush's request. Nothing is committed yet; the dev
stack is stopped (`docker compose stop`, containers and volumes kept); the
installed app was not touched.

### Where the language eval stopped (`scripts/language_eval.py`, untracked)
Data in `test-assets/fleurs/` (gitignored, never commit); results per run in
`test-assets/fleurs/results/`, saved after each language.
- Done: `fetch`; `mt` (en and hi into all 13); `asr` large-v3 GPU, all 13;
  Apex (Hinglish) GPU, hi; large-v3-turbo CPU: en, hi, nl, and mr, bn, ta
  (kept as evidence for their removal); small CPU: nl.
- Stopped: large-v3-turbo CPU on ml, killed mid-run (pid in the worker),
  nothing saved for it. Tamil, Marathi, Bengali and Malayalam are skipped
  from here on (removed in v1.0.11).
- Left, in this order (Tanush, 2026-10-22):
  1. `python scripts/language_eval.py asr --langs en,hi,es,pt,it,ru,fr,de,nl`
     (resumable: runs only turbo CPU es, pt, it, ru, fr, de and small CPU
     en, hi, es, pt, it, ru, fr, de; about 70-90 min). Nothing else on the
     CPU meanwhile: its timings are part of the report.
  2. `pipeline --base http://localhost:3001 --langs en,hi,es,pt,it,ru,fr,de,nl`
     (plus hi/roman; deletes each video it makes, by id), then `report`,
     results into TESTING.md and the PRD's known limitations, eval commit.
  3. v1.0.10 release checklist (release workflow and 8 assets already
     verified green on a1b822a), back up the install to
     `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.0.10`, `vcm update`,
     verify, then delete the `pre-1.0.9` backup.
  4. A Tamil test video uploaded on the current (v1.0.10) code, to check
     after v1.0.11 that an existing video in a removed language opens and
     exports; deleted afterwards by id.
  5. v1.0.11, then `language_eval.py clean` and the release steps.

### Bug found by the eval (fix approved for v1.0.11)
The fixed -40 dB silence threshold takes quiet recordings for silence: 27 of
50 English FLEURS clips (peaks -44 to -54 dB, speech at -56 to -64 dB) and 1
French came back with no captions, every segment dropped as invented over
silence. English large-v3 WER 59% is this bug, not the model.

### v1.0.11 (written, not yet applied or tested)
Saved twice: `git stash list` ("v1.0.11 WIP ... based on a1b822a") and
`test-assets/v1.0.11-wip.patch` (`git apply --check` passes on main).
Apply only after step 1-2 above: the dev backend is bind-mounted, so the
change would alter what the eval measures.
- Quiet audio: silence is under -40 dB, or 15 dB under the file's speaking
  level if that's lower, never under -80 dB (`silence_threshold`); ordinary
  recordings (speaking at -19 to -31 dB) are judged as before.
- A job with no captions finishes with "No speech was found in this video."
  as its notice.
- Tamil, Marathi, Bengali, Malayalam removed as caption and spoken languages
  (`languages.RETIRED` keeps their names); detected speech not offered shows
  "<Language> speech isn't supported yet, so captions would be inaccurate."
  with a spoken-language picker or "Try anyway (low quality)", neither
  preset; "Try anyway" + "Same as spoken" kept (Tanush), with a note on the
  video page. Existing videos keep their captions and export; their Redo asks
  for an offered language. Fonts kept.
- Tests written: `test_languages_offered.py`, quiet/silent/no-speech tests in
  `test_transcription.py`, `checks.js unsupported-speech` and
  `retired-language`; none run yet.
- Still to do: run backend, frontend and ui-check suites; re-run English on
  the GPU with the fix; docs (README without "Same as spoken works for any
  language", PRD, CHANGELOG, ROADMAP "re-add with Indian-language
  fine-tuned speech models (e.g. AI4Bharat)" with the eval numbers, TESTING).

## v1.0.10 (released 2026-10-22, tag on a1b822a)
Brief (Tanush, 2026-10-22): stretches of 1-2 s where someone speaks and no
caption appears, seen on video 84 after a Redo. Find every one (over 0.7 s)
on video 84 and `hinglish.mp4`, find why, fix with the smallest change on
every model and both scripts, never invent text, tests that fail before and
pass after, release as v1.0.10.

### Findings
- Video 84 is **not** in Hinglish: its Redo ran on large-v3 in Devanagari
  (`hindi_script` NULL, captions "यह एक्सुलिम हमारी SRT…"). The editor offered
  "Hindi in" only for videos already heard as Hindi, and a video from
  before v1.0.9 had nothing recorded until its next job. Fixed: offered
  unless the video is known not to be Hindi.
- Uncaptioned speech over 0.7 s (audio: speech band within 18 dB of the
  speaking level), `hinglish.mp4` = video 84's audio:
  - large-v3: 25.52-27.60 s "manually koi text likhna nahi padta hai. To
    sabse pehle hum" and 77.50-80.00 s "Islie ham log download ke actions par
    click karenge." (both on video 84; its two other caption gaps, at 145 s
    and 200 s, aren't speech);
  - turbo GPU: 56.24-57.74 s, 77.86-78.88 s; turbo CPU: 66.44-67.30 s,
    67.52-69.00 s;
  - Apex GPU and CPU: none.
- Why (none of VAD, the no-speech/log-probability/compression filters, or
  phrasing: VAD is off on every path, the segments had logprob -0.09 and
  no_speech 0.16, and phrasing never saw the words):
  1. 25.5-27.6 s: large-v3 put 8.3-27.6 s in one segment holding only its
     first words; after the word-length cap the 2.1 s left was under the 4 s
     re-decode rule. Decoded alone it gives "कोई text इतना नहीं पड़ता है तो
     सबसे पहले हम".
  2. 77.5-80.0 s: re-decoding ran and found "हम लोग डाउनलोड के एक्शन पर
     क्लिक करेंगे", but the onset snap had moved its start to 77.25 s, before
     the 77.48 s stretch, and `_decode_stretch`'s filter threw it away.
  The re-decoding (`_fill_skipped`) runs on the Apex path as on the others.
- First fix (rule and margin) left two side effects, both fixed: gaps
  measured from snapped segment starts made a false "gap" of the next
  caption's own words (Apex said "Hamko bas" twice; 3 late caption starts),
  and recovered stretches repeated their neighbours' edge words.

### Done
- [x] `services/transcription.py`: short voiced stretches re-decoded;
      0.5 s margin at a stretch's start; gaps between words; edge repeats
      said once; nothing usable is logged and left empty.
- [x] Measured (TESTING.md, "Speech with no caption"): 0 uncaptioned
      stretches on large-v3, turbo GPU/CPU and Apex GPU/CPU; caption starts
      as in v1.0.9; no repeated word pairs; WER equal or better.
- [x] Tests: 7 in `test_transcription.py` (5 fail on v1.0.9; the 2 that
      pass guard against re-decoding silence or snapped starts);
      `checks.js redo-script` (fails on v1.0.9's editor);
      `backend/scripts/coverage_check.py` for real videos.
- [x] Dev stack: Hinglish and Devanagari uploads of `hinglish.mp4` pass
      `coverage_check.py` and `timing_check.py`; deleted (7588, 7589).
      Video 84 on the install was only read.
- [x] Backend 519 passed, 1 skipped; ruff, frontend lint, type-check and
      tests clean.

### Release check (2026-10-23)
- Tag v1.0.10 on a1b822a; CI and `release.yml` green on it; 8 assets, all 7
  match SHA256SUMS; 1.0.10-cuda, 1.0.10-cpu and frontend 1.0.10 fetch
  anonymously (200).
- Backup per DATABASE.md §7 (31 s downtime, including a busybox pull):
  `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.0.10` (vcm.dump 32 KB,
  all 7 tables; vcm-media.tgz 284 MB, 28 files as on the volume; .env copy;
  rowcounts: 1 video, 159 captions, 5 exports, 1 style, caption-text md5).
  The `pre-1.0.9` backup deleted, as Tanush asked.
- `vcm update` (Windows GPU) in 36 s: the API reports 1.0.10, alembic
  `b6e0f4a9c2d1` (head, no migration); rows and caption-text md5 unchanged.
  Download **7.4 MB**: backend CUDA 3/15 layers, 0.2 MB; frontend 4/10,
  7.2 MB.
- Guard (POST): own origin passes at localhost and 127.0.0.1 (422, no
  file); another port, another origin, cross-site and a rebinding Host 403.
  `flow.js` 7/7 PASS at both addresses, nothing refused.
- E2E on the install, `hinglish.mp4`: same (128 captions, 110 s), en (126,
  41 s), es (134, 110 s), SRT, VTT and MP4 each: ALL PASSED.
  `coverage_check.py` on the Devanagari video: PASS (0 uncaptioned
  stretches). `timing_check.py`: one 0.60 s caption ("है गाइस", 200.48 s,
  before a 0.5 s pause): the minimum-length and flicker rules meet there.
  Reported, not changed.
- Test videos 94, 95, 96 (E2E) deleted: 95 and 96 by `flow.js`, 94 by
  `DELETE /api/videos/94`. The install holds video 84 only, as before.
  Check scripts copied into the worker's /tmp for the run, then removed.
- Secrets: nothing forbidden in git history (`docs/learning-guide.md` was
  tracked for one commit on 2026-08-06, not a secret); the 1.0.10 images
  hold only public CA bundles (grpc's roots.pem). The 1.0.10 tags pulled
  for the check and busybox:latest untagged again.

## v1.0.9 (released 2026-10-21, tag on 1a5cf30)
Started 2026-10-19, after v1.0.8 was released and the install updated.
Order (Tanush, 2026-10-19): Problem 1, then Problem 2, then transcription
settings (Phase 2). The UI redesign is v1.1.0, when Tanush sends it.

### Problem 1 — captions about 1 s late
Seen on the installed v1.0.8 after Redo on video 84 (Hindi).
- [x] Measure on `hinglish.mp4` (dev, port 3001) in Hindi, "Same as spoken"
      and English, per place. Truth word times by forcing `truth-hi.txt` onto
      the audio (torchaudio MMS aligner, scratch only; within ~0.05 s of
      Whisper's starts and the waveform where both are clear). Installed
      video 84 (v1.0.8, large-v3): mean +0.30 s, worst **+2.61 s late**, in
      stretches of +1.3 to +2.6 s, not growing over the video (drift inside
      each run of speech, reset at every pause). SRT/VTT = stored to the ms;
      the burn shows each caption on the first frame at or after its start
      (+0 to +42 ms at 24 fps, mean +21); the preview matches the playhead on
      every frame (721 of 721, three videos). So all of it was in the stored
      times.
- [x] Root cause. Not Whisper (its raw word starts: median −0.12 s against
      the truth, 2 of 185 more than 0.1 s late), not the preview (it already
      follows requestAnimationFrame while playing), not FFmpeg. It was
      v1.0.8's re-timing: `_speech` clipped each segment's words to its
      onset-snapped start, so the first words of 18 of 89 segments fell off;
      text and timed words then differed, and `rephrase` spread such a
      sentence by its share of the text over the whole run of speech
      (median run 11.2 s, longest 78 s), every caption after the first in a
      run drifting further. Only 2 of 6 sentences took the exact path.
- [x] Fix (`services/phrasing.py`, `services/transcription.py`):
      - words kept as Whisper timed them (not clipped to the snapped start;
        zero-length words kept);
      - every word timed on its own by a sequence match, an untimed word
        placed between its timed neighbours (or for its text's length next to
        the one known neighbour, never past its segment's end); each caption
        starts on its first word and ends on its last; a sentence mostly
        translated keeps the old by-share spreading;
      - word starts checked on a 20 ms speech-band envelope
        (`_words_on_onsets`): a word timed into a pause of 200 ms or more
        starts where the voice comes back. Measured: large-v3 English mean
        −0.31 → −0.09 s, captions over 0.2 s early 17 → 3.
      Result, offset per caption against the speech (docs/TESTING.md has the
      table): Hindi large-v3 worst +2.61 → +0.13 s late, 23 → 3 captions
      outside the rule; English and Spanish no worse on either model.
- [x] Still outside the rule: Whisper's own word timestamps, up to ~0.15 s
      late and ~0.25 s early (one long Spanish word 0.55 s early), 3-4
      captions in 22-35 per clip. The pipeline adds 0-20 ms. Closing that
      needs a forced aligner (a wav2vec2/MMS model) after Whisper. Tanush,
      2026-10-20: not now; on docs/ROADMAP.md with these numbers.
- [x] Confirmed on automatic model selection (2026-10-21). With the
      `WHISPER_*` lines gone from the dev `.env`, the dev worker picks
      large-v3 on CUDA. Fresh uploads, stored captions: Hindi (7543) and
      Same as spoken (7544) mean −0.10 s, worst +0.13 s late and −0.26 s
      early, 3 of 32 outside the rule. That is the harness result exactly.
- [x] English translated from Hindi (7545) has no first word to measure
      against: Whisper's English words are timed against Hindi audio, and an
      English sentence rarely starts on the word its Hindi does. Against
      the Hindi phrase each caption translates (7 spot checks, by hand):
      v1.0.8 ran +0.60 to −0.52 s, now −0.04 to −0.63 s. The late ones are
      gone; what's left runs early. A limitation of translating in Whisper,
      not a timing bug.
- [x] Tests, fail on v1.0.8 and pass now: `test_caption_phrasing.py`
      (Hindi, English, Spanish sentences in one run with untimed first words:
      +230 / −428 / −251 ms before; an untimed word between neighbours),
      `test_transcription.py` (words not clipped to the snapped start;
      zero-length words kept; a word after a pause, a word inside a pause).
      Guards that pass before and after: SRT/VTT cues at the stored start
      and a real 24 fps burn within one frame (`test_exports.py`), a word said
      before a pause and a consonant closure not moved, a guessed last word
      not pushing the next caption. Preview: `checks.js caption-timing`
      (every frame within one frame; fails on a 250 ms shift).

### Problem 2 — Hindi/Hinglish captions still very bad (done)
Replaces the IndicXlit plan (IndicXlit kept only as a fallback).
- [x] Candidates, Whisper fine-tunes that write Roman Hinglish with English
      words in English spelling: `Oriserve/Whisper-Hindi2Hinglish-Prime`
      (large-v3 fine-tune, GPU) and `Oriserve/Whisper-Hindi2Hinglish-Apex`
      (large-v3-turbo fine-tune, CPU). **Licences (2026-10-21): both usable
      commercially.** Apache-2.0 in the card metadata (not gated); the
      GitHub repo `OriserveAI/Whisper-Hindi2Hinglish` has an Apache-2.0
      LICENSE; bases are OpenAI Whisper (MIT); no use restrictions stated.
      Caveats: the model repos have no LICENSE file of their own; training
      data is only described ("~550 h proprietary" for Prime, "~700 h
      open-source and proprietary" for Apex, auto-labelled by an unnamed
      model then corrected by hand), with no terms passed to users.
- [x] Converted with the worker's own `ct2-transformers-converter`
      (CTranslate2 4.8.1), float16 weights; int8 chosen at load on CPU.
      Neither repo ships `alignment_heads`, which word timestamps need: the
      base models' (OpenAI's `generation_config.json`) were written in
      first. Apex 1.62 GB (download 1.62 GB), Prime 3.09 GB (download 6.17
      GB, float32); each converts in about 5 s. Both decode with
      `language="en"`, as their cards say (`hi` gives the same Roman text).
- [x] Scored through the app's own `transcribe()` + `rephrase()` on the
      whole 228 s clip, against `truth-hi.txt` (first 62.8 s: 264 words, 73
      of them English). Base models' Devanagari romanised first by a fixed
      table (the caveat: it adds errors of its own; CER and "loose" WER,
      with spelling variants folded the same way for every model, lean on
      it less). Caption starts against the forced-aligned words (Problem 1).
      Dev machine: RTX 5080; CPU runs in the dev worker.

      | Model | WER | WER, loose | CER | English words | Starts outside rule | 228 s takes | Memory | Download |
      |---|---|---|---|---|---|---|---|---|
      | Prime, GPU | 31.1% | 20.8% | 13.9% | 66/73 | 9 of 42 (worst −0.36 s) | 24.9 s | 4.2 GB VRAM | 6.2 GB |
      | **Apex, GPU** | 31.1% | 20.8% | 14.1% | 65/73 | **0 of 42** | **7.6 s** | 2.5 GB VRAM | **1.6 GB** |
      | **Apex, CPU int8** | 30.7% | 20.5% | 13.8% | 66/73 | 1 of 43 | 35.5 s | 1.8 GB RAM | 1.6 GB |
      | large-v3, GPU (today's GPU default) | 73.9% | 56.4% | 47.9% | 12/73 | 3 of 31 | 109.4 s | 5.3 GB VRAM | (installed) |
      | large-v3-turbo, GPU | 64.8% | 53.8% | 40.0% | 26/73 | 2 of 33 | 37.4 s | 2.5 GB VRAM | (installed) |
      | large-v3-turbo, CPU int8 | 65.5% | 52.7% | 41.1% | 29/73 | 2 of 32 | 114.8 s | 1.8 GB RAM | (installed) |
      | small, CPU int8 | 79.5% | 69.7% | 47.1% | 14/73 | 3 of 34 | 369.5 s | 1.4 GB RAM | (installed) |

      The fine-tunes cover the whole clip (~1,000 words, no gap over 3 s;
      small leaves 192-222 s uncaptioned) and are fast because they don't
      need the re-decoding of skipped stretches the base models do.
      Apex is as accurate as Prime, 3x faster, half the memory and download,
      and its word timings are clean; Prime's run early with large-v3's
      alignment heads. So **Apex wins on both tiers**, not Prime on GPU.
- [x] 10 sample lines, every model beside `truth-hi.txt`: in the scratch
      report (not committed: it quotes the test clip). E.g. at 0.00 s,
      truth "To video mein captions auto generate"; Apex "To videos mein
      captions auto generate"; large-v3 "तो वीडियोस में कैप्शन्स ऑटो जेनेरेट";
      small "तो वीडियोंस में कैप्ष्यंस अड़़द़ईट".
- [x] The question (2026-10-21). **Tanush: add it on Apex (GPU and CPU),
      Hinglish the default for Hindi, on these conditions:**
      - the language step, when the spoken language is Hindi (detected or
        chosen), shows "Hindi captions in: Hinglish (Roman) / हिन्दी
        (Devanagari)", defaulting to Hinglish, changeable before processing;
      - translation into other languages doesn't take the Roman Hinglish as
        its source unless measured to translate as well: Hinglish → Marathi,
        Spanish and English on `hinglish.mp4`, against translating from the
        large-v3 Devanagari transcript; use whichever is clearly better, and
        report the extra time if it needs a second transcription pass;
      - detected Marathi, or Hindi detected below about 70% confidence: no
        Hinglish default, the language step asks instead;
      - existing videos keep their captions until Redo;
      - the 1.6 GB download's size and progress are shown the first time.
      Prime is not used: no more accurate than Apex, 3x slower, twice the
      memory and download, and its caption starts run early.

### Problem 2, implementation
Decisions (Tanush, 2026-10-21):
- Translation source for Hindi spoken as Hinglish: **B**, Apex's Roman
  Hinglish → IndicXlit (Roman → Devanagari) → M2M100, all-caps words (SRT,
  AI) kept as they are. A (Roman straight into M2M100) barely translates:
  it copies English and Spanish through and invents Marathi. 15 English, 5
  Marathi and 5 Spanish lines are in the scratch report. IndicXlit's
  rescoring dictionaries changed nothing (and unpack to 7.5 GB): not used.
- **English captions keep Whisper's own translate pass** (today's path):
  the Hindi script choice decides how Hindi is written and the source of
  the other translations, and doesn't apply to English. Measured: Whisper's
  English for this clip reads "In the videos, I am going to tell you how to
  auto-generate captions… known to very few people", far better than A or
  B through M2M100.
- **Flow:** upload when the file is picked; the worker detects the spoken
  language from the first 30 s while the caption language is chosen.
  Hindi at 70%+: "Hindi captions in: Hinglish (Roman) / हिन्दी (Devanagari)",
  preset to Hinglish. Marathi or Hindi under 70%: the same choice (plus
  मराठी when Marathi was heard) with nothing preset, and Start waits for a
  pick. Detection over 15 s: the choice without a preset, and Start is
  allowed (the worker then applies the same rule). Back or closing the page
  deletes the upload and its files; uploads never started are swept after
  an hour. The PRD's "nothing is sent before Start" changes.
- **Models download on first use, from their original repos, pinned:**
  `Oriserve/Whisper-Hindi2Hinglish-Apex` at `f3214eed20b4e4d4144e739982d911f87b9cb223`
  (`model.safetensors` sha256 `5560830f…ebca80`, 1.62 GB) and
  `ai4bharat/IndicXlit` at `e7049fe725b11c0a187d42edeb2f56aa1ffee5fd`
  (`indicxlit-en-indic-v1.0/transformer/indicxlit.pt` sha256 `2f03fe0d…224a09f7`,
  138 MB). Each is checked against its sha256 and converted on the machine
  (CTranslate2; IndicXlit without fairseq, from the raw weights: 352 of
  353 words identical to fairseq's output, the other differs only in the
  package's own apostrophe handling). Nothing is baked into an image.
  Existing videos keep their captions until Redo; the API default for a
  client that doesn't send a script stays Devanagari.

Plan (files, in commit order):
1. Models: `services/hinglish.py` (new: pinned download, sha256 check,
   conversion, transliteration), `services/model_store.py` (revision),
   tests. (`transformers` stays implicit, via sentence-transformers: naming
   it in `pyproject.toml` would change the dependency layer every update
   downloads, 2.2 GB on CUDA last time; a test fails if it goes missing.)
2. Data and API: `models/video.py` (`held`, `hindi_script`,
   `detected_language`, `detected_confidence`), a migration,
   `schemas/video.py`, `services/video.py` (held videos unlisted, swept),
   `api/videos.py` (`hold` on upload, script options with download size,
   Start through `POST …/transcribe`), tests.
3. Worker: `detect_language` task, Apex for Hindi in Roman,
   transliteration before M2M100 (`workers/transcription.py`,
   `services/hardware.py`, `services/transcription.py`,
   `services/languages.py`), tests.
4. UI: upload on pick, detection status and the script choice in the
   language step, the same choice in the editor's Redo, delete on Back or
   page close; `checks.js hindi-script`.
5. Docs: PRD, ARCHITECTURE, API, DATABASE, SECURITY, TESTING, DECISIONS,
   CHANGELOG.
Verify: backend suite, frontend lint/type-check/test, ui-check (axe 0),
`scripts/e2e.py` on the dev stack, a real Hinglish upload end to end.

Done (2026-10-21), all committed:
- [x] 1. Models: `services/hinglish.py` (a5e8744). Through the app's own
      code on the dev stack: IndicXlit downloaded, checked and converted
      in 16 s; Apex in 147 s, byte-identical to the scratch conversion it
      was scored with. 7 tests, no network.
- [x] 2. Data and API (39e29f7, 655e701): migration `b6e0f4a9c2d1`; held
      uploads left out of the list, stats and startup recovery (which would
      have started them); swept after an hour.
- [x] 3. Worker (717b107, 7d06d32): detection task; Apex for Hindi in Roman;
      IndicXlit before Gemini/M2M100; English still Whisper's translation;
      the job records what it heard (for the Redo) and the script `auto`
      resolved to; a failed detection clears "detecting". 22 tests.
- [x] 4. UI (2396b5f, 020eaea, 1ab86f0): upload on pick; "Hindi · heard at
      98%"; the choice per the rules; Start while uploading starts when it
      lands; Back and page close delete the upload (checked against the
      real backend: both 404 afterwards); Redo's "Hindi in".
      `checks.js hindi-script` passes at 375 and 1440 px, axe 0 in light
      and dark; screenshots looked at in both themes.
- [x] Real flow, dev stack (large-v3 auto, RTX 5080), no mocks:
      `hinglish.mp4` picked → "Hindi · heard at 98%" 5.5 s later, upload
      included → Hinglish preset → Start. Apex transcribed 228 s in 9 s;
      captions "To videos mein captions auto / generate karne ka aisa
      tarika aapko …"; caption starts **0 of 43 outside the timing rule**
      (mean −0.07 s, worst +0.03 / −0.18 s). Spanish went through
      IndicXlit (Gemini answered 503 three times, M2M100 took over);
      English stayed Whisper's translation. A second upload's detection
      waited 28.6 s behind a running job, as designed.
- [x] `scripts/e2e.py` (same, en, mr; SRT, VTT, MP4) ALL PASSED: uploads
      without the new fields behave as before (Hindi in Devanagari).
- [x] Backend suite 511 passed, 1 skipped; ruff clean; frontend lint,
      type-check and tests clean; frontend production build
      (`docker build --target build frontend`) succeeds.
- [x] Test data: dev videos 7546–7550 (created by the first, unmocked check
      run: the dev frontend calls the API on :8000, so origin-based mocks
      missed; the mocks now match by path), 7580–7581 (close/navigate
      deletion test, deleted by the page itself), 7582–7587 (real flow and
      e2e): all deleted through the API. Scratch models (3.1 GB in the
      worker's /tmp, 9 GB of Prime earlier), the IndicXlit test container
      and the python:3.10/3.11-slim images removed.
- Note: sizes are shown in binary GB like the rest of the app, so Apex's
  1.62 billion bytes reads "1.5 GB" in the language step and the download
  progress.
- Open: Gemini is given IndicXlit's Devanagari too; measuring it on Roman
  Hinglish needs a working key (it answered 503 today).

### Release check (2026-10-22)
- Tag v1.0.9 on 1a5cf30; CI green on it; `release.yml` green; 8 assets,
  all 7 match SHA256SUMS; the 1.0.9 images fetch anonymously (200).
- Backup per DATABASE.md §7 before the update (23 s downtime):
  `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.0.9` (vcm.dump 30 KB,
  vcm-media.tgz 284 MB, .env copy, rowcounts: 1 video, 121 captions, 5
  exports, 1 style, caption-text md5). Kept until Tanush confirms.
- `vcm update` (Windows GPU) in 118 s: VCM_VERSION 1.0.9, alembic
  `b6e0f4a9c2d1` (head); rows and caption-text md5 unchanged; video 84 has
  no script (Devanagari until a Redo) and isn't held. Download **7.4 MB**:
  backend CUDA 4/15 layers, 0.2 MB; frontend 4/10 layers, 7.2 MB.
- Guard (POST, so the rules past "safe methods" apply): own origin passes
  at localhost and 127.0.0.1; another port, another origin, cross-site and a
  rebinding Host 403. `flow.js` PASS at both addresses.
- First use on the install: the language step said "Downloads 1.5 GB the
  first time"; Hindi heard at 98% 12.7 s after picking `hinglish.mp4`;
  Apex downloaded in 2 min 18 s, converted in 4 s, transcribed 228 s in
  10 s ("To videos mein captions auto / generate karne ka aisa tarika …").
  Spanish: IndicXlit downloaded (shown as "Downloading the Hindi
  transliterator (first use only)") in 15 s, converted in 4 s; captions in
  Spanish. A second upload's detection waited behind the first job's
  download, as designed (Spanish captions, so nothing was asked).
- E2E on the install: same, en, mr with SRT, VTT, MP4 ALL PASSED.
- Test videos 89-93 deleted (91, 93 by flow.js; 89, 90, 92 through the
  API); the install holds only video 84 again.
- Secrets: none in history or the 1.0.9 images (no .env, key, dump, extra
  cert, or model file). History does hold `docs/learning-guide.md`, added
  and untracked on 2026-08-06 (79da389, 4dc2628): not a secret, predates
  the rule; rewriting published history would be Tanush's call.

### Then: transcription settings (Phase 2)
Keep only what measurably helps, with a before/after table per setting and
hardware tier. Ask before any model change.

### Decisions (Tanush, 2026-10-19)
- **Truth script: Roman only.** `test-assets/truth-hi.txt` (first 60 s of
  `hinglish.mp4`, natural Roman Hinglish, one caption a line with its start
  time), verified by listening. Score Whisper's output after converting it
  to Roman, with the caveat that the conversion adds its own errors; lean on
  CER too.
- **Also report "English-word accuracy":** of the English words in the truth
  (captions, SRT file, customize, auto generate, …), how many come out right.
- `hinglish.mp4`'s audio is identical to `bug-mr.mp4.mp4`'s (same decoded
  MD5, 228.32 s).

### Speech recognition for non-English speech — Phase 1, measured (2026-10-19)
Brief (Tanush): transcription works for English but not other spoken
languages; measure before changing anything, then improve without switching
models. No code changed for this phase.

Setup: dev stack (v1.0.8 code), the app's own `transcribe()` with each model
loaded explicitly. `test-assets/hinglish.mp4` and `truth-hi.txt` were **not
in the folder**, so the Hinglish clip is the same audio taken from
`bug-mr.mp4.mp4`, and it has no ground truth yet: no WER for it. Two more
clips with exact transcripts were generated with Piper TTS (open voices
`hi_IN-pratham-medium`, `es_ES-davefx-medium`): plain Hindi (45.6 s, 138
words) and Spanish (39.5 s, 136 words). WER/CER on NFC-normalised text,
punctuation and nukta ignored.

**Language detection:** once, over the first 30 s, then forced for the whole
file (`detect_language` → `transcribe(language=hint)`); not per segment.
Hinglish detected as `hi` (large-v3 0.98, turbo 0.55, small 0.98).

| Clip | Model / device | WER | CER | Time |
|---|---|---|---|---|
| Spanish (TTS) | large-v3 / GPU | 0.066 | 0.044 | 4 s |
| | large-v3-turbo / CPU | 0.103 | 0.071 | 10 s |
| | small / CPU | 0.140 | 0.083 | 5 s |
| Hindi (TTS) | large-v3 / GPU | 0.225 | 0.103 | 12 s |
| | large-v3-turbo / CPU | 0.275 | 0.146 | 23 s |
| | small / CPU | 0.486 | 0.199 | 12 s |
| Hinglish (real) | all | — (no truth) | — | 82 / 143 / 283 s |

Error examples:
- Spanish, large-v3: numbers as digits ("quince"→"15"), a few dropped short
  words ("los", "la"), "apaga"→"apara". Mostly fine: non-English in general
  is not the problem.
- Hindi (TTS), large-v3: spelling variants that count as errors but read
  fine (आँच→आंच, सीखेंगे→सिखेंगे, मिनट→मिनिट, ऊपर→उपर), digits
  (पंद्रह→15), and real errors around compound verbs (डालकर→कर,
  "छलनी से छानकर"→"छली से च्छान कर"). Small: much worse (घर→गर,
  टमाटर→तमातर, सूप→सुभ).
- Hinglish (real, first 60 s): no stretches missing (the v1.0.8 re-decode
  fills them; before it, 8-29 s was lost) and no repetition loops beyond a
  lone repeated "में"/"है". The problems are script and English words:
  - large-v3 writes the English words in Devanagari, misheard: "कैप्शन्स
    ऑटो जेनेरेट" (captions auto generate), "यूजिंग" (using), "ओडियो इंदी"
    (audio Hindi), "केप्टिशन्स"; only "SRT" in Latin (209 Devanagari, 6
    Latin words);
  - large-v3-turbo writes them in Latin ("captions auto generate", "using
    srt file", "customize"): 199 Devanagari, 29 Latin — closer to how
    Hinglish is written, but detection was only 0.55 sure;
  - small garbles both (अड़़द़ईट, युजिं सर्टी फाई).

Waiting on: `hinglish.mp4` and `truth-hi.txt` (Tanush) for the Hinglish WER,
which Phase 2 must improve.


## v1.0.8 (released 2026-10-19, tag on 236b9ce)
Brief (Tanush, 2026-10-17): caption line control. Manual line breaks
(Shift+Enter), a Line style setting (Auto / Balanced / Stacked with Words per
line), and a fit rule that shrinks past 70% when the box would be taller than
the safe area. One shared layout rule (backend + its frontend copy); SRT/VTT
use the burn's lines; a migration that leaves every existing video as it is.
This section is the resume point.

### Answers (2026-10-17)
- **Redo and manual breaks:** a caption keeps its manual breaks across Redo
  only if the caption language is unchanged and its words exactly match an
  old caption that had breaks (breaks put back at the same word positions).
  Any other new caption starts without manual breaks.
- **Port 3000:** the dev UI runs on port 3001 (an uncommitted compose
  override); the installed app keeps 3000 throughout. GPU jobs run on one
  stack at a time.

### Found before starting
- Shift+Enter already inserts `\n` in the caption textarea (Enter saves),
  and the v1.0.7 layout already breaks at `\n`. Missing: SRT/VTT write the
  raw text, not the burn's lines; no tests; Redo drops breaks.
- v1.0.7's wrap is already near-balanced (greedy for the count, then the
  narrowest width keeping it). "Auto = current behaviour" keeps it exactly;
  Balanced must therefore even the lines further (see decisions).

### Backlog
- [x] L1 Model + migration: `line_style` (auto/balanced/stacked, default
      auto), `words_per_line` (1-4, default 2); `max_lines` up to 6 (Stacked).
- [x] L2 Layout (backend + frontend copy): Balanced, Stacked, manual breaks
      counted as lines, fit rule below 70% until the box fits the safe area.
- [x] L3 SRT/VTT written with the layout's lines at the video's own size.
- [x] L4 Redo keeps manual breaks on an exact match in the same language.
- [x] L5 Style panel: Line style with descriptions, Words per line; Max lines
      range by style; keyboard and screen reader; axe 0.
- [x] L6 Tests per the brief; parity per line style x 16:9, 9:16, 1:1.
- [x] L7 Docs: PRD, DESIGN_SYSTEM, API, DATABASE, ARCHITECTURE, TESTING,
      CHANGELOG (Unreleased -> 1.0.8).
- [x] L8 Suites, build, GPU E2E (en, hi + one more x each line style), a
      burned MP4 per line style in 16:9 and 9:16 by eye; delete every test
      video in both stacks; dev stack stopped.

### Decisions
- **Auto vs Balanced** (asked, Tanush 2026-10-18): Auto fills each line to
  the box width (ragged); Balanced is v1.0.7's even wrapping and the default
  for existing and new videos, so nothing looks different unless Auto is
  picked. (Measured first: a "most even split" Balanced on top of v1.0.7's
  wrap differed from it in 1 case of 75, so it would have been a no-op.)
- **Max lines when switching style:** choosing Stacked sets Max lines to 4
  (its default); leaving Stacked with more than 3 sets it back to 2 (the
  other styles offer 1-3). The API accepts 1-6 for any style.
- **Fit rule:** past 70% the font keeps shrinking in the same 2% steps, down
  to 10%, only while the box (with outline, shadow and overhang) is taller
  or wider than the safe area. The wrap width is also capped at the safe
  area's width, so a 94% box never pushes text past it.
- **Stacked and long groups:** a group of N words too wide for the box is
  wrapped by Balanced's rule inside itself, like any manual line.
- **SRT/VTT lines:** laid out on the video's own frame (probed at export),
  with the video's style, mapped back onto the original letter case for an
  uppercase style. Without readable dimensions the stored text is written
  as is (manual breaks only).
- **Redo:** the route decides (`keep_breaks` when the caption language is
  unchanged or not sent); the worker reads the old captions' breaks before
  deleting them and restores them on captions whose words match exactly.
- **Caption textarea:** sized by its lines, so a manual break doesn't hide
  the second line.
- **"Renders exactly as before":** `tests/data/burn-1.0.7.json` holds the
  Style and Dialogue lines the v1.0.7 code produced for 4 styles x 3 frames
  x 6 captions; the new code must produce them byte for byte with the
  migrated defaults. (This one can't fail before the change: it is the
  guard that the change didn't move anything.)
- **Dev UI on 3001:** a scratch compose override publishes the dev frontend
  on 127.0.0.1:3001 and adds it to the dev backend's CORS_ORIGINS; nothing
  committed. Test videos created in the dev stack: 7497, 7498, 7499.

### Bugs added to v1.0.8 (Tanush, 2026-10-18)
Evidence in `test-assets/` (now gitignored; it wasn't). `hinglish.mp4` was
not in the folder: the checks use its audio taken from `bug-mr.mp4.mp4`
over a plain picture (a scratch file, never committed).

- [x] **Bug 1, an SRT in the wrong language.** Root cause, from the
      install's own rows: the "Hindi" SRT (8,244 bytes, export 179) was made
      at 06:57, nine minutes before a Redo wrote the current captions. Every
      export reads the captions it's given; the list just never said which
      ones, so the old file was taken for the new. Fix: exports record their
      caption language and which set of captions (`captions_from`); the API
      serves `caption_language` and `current`; the list labels each export
      and marks "From earlier captions". Test: all 4 formats x 3 languages
      back to back.
- [x] **Bug 2, JSON escapes.** `json.dumps` defaulted to ASCII;
      `ensure_ascii=False`. Test with Devanagari.
- [x] **Bug 3, single words over long times; cut sentences; counts.** Three
      causes, measured on the clip:
      1. Whisper's seek skipped speech after a window ended on a garbled
         token (8-29 s, 96-116 s, 180-201 s empty in Hindi; decoded alone
         the same audio gave clean phrases). Fix: no conditioning on the
         previous window, and every 4 s+ uncaptioned stretch decoded again
         alone, recursively (it can stop early too).
      2. Alignment stretched a word over the pause after it (".T." 8.1-19.1,
         "हैं।" 66.0-87.8 s) and `_split_long` made it a caption. Fix: word
         timings capped at 3 s.
      3. `split_like` forced translated sentences back into the source's
         slots. Fix: `services/phrasing.py` re-cuts every language into
         phrases (punctuation, natural groups: no auxiliary or postposition
         first, conjunctions preferred, no lone words).
- [x] **Bug 3, timing rules** (added mid-way): captions timed to Whisper's
      word timestamps, kept per segment through translation and stored on
      the video (`videos.speech`); runs split at pauses of 0.5 s+; breath
      gaps closed to 80 ms, pauses kept at 0.5 s+; tail ≤ 0.5 s; 0.8-7 s; a
      squeezed caption joins the neighbour the speech runs into. Rules run
      only in the transcription job, so manual retiming survives until Redo.

Measured (dev, GPU, the Hinglish clip; ids recorded for deletion):

| | v1.0.7 code | final |
|---|---|---|
| Hindi captions (vs English) | 66 (0.54) | 128 (1.01) |
| Marathi | 51 (0.42) | 118 (0.93) |
| Spanish | 76 (0.62) | 139 (1.09) |
| single-word captions | up to 14% | 0-2 |
| longest caption | 21.8 s | 4.8 s |
| `timing_check.py` | FAIL (46-118 violations) | ALL PASSED |

Decisions:
- **Stored word timings** (`videos.speech`, JSON) rather than checking
  against a second decode: Whisper places words differently run to run, and
  the rule is about the timings the captions were made from.
- **Phrase size 32 characters** (English from Whisper's translate path has a
  median of 33); a phrase never starts with Hindi/Marathi/Bengali auxiliaries
  or Hindi postpositions ("की" excluded: Marathi conjunction).
- **A pause in the speech decides the gap**, not the gap between captions: a
  minimum-length extension may grow into a pause only while 0.5 s of it
  stays empty.
- **"A retimed caption keeps its timing"** holds by design (the rules live
  only in the job); its test can't fail before, as for the 1.0.7 guard.
- **Translation quality** (M2M100 into Marathi sometimes invents a line, as
  at 22.8 s of the clip) is unchanged; a model switch is Tanush's call.

### Definition of done (2026-10-18)
- [x] Every test in both briefs fails before and passes after (or, for the
      two guards that can't, says so): line control (`test_line_control.py`
      28 of 34 fail on the old code), bugs (`test_exports.py`,
      `test_caption_phrasing.py`), and on the real clip
      `caption_quality.py` + `timing_check.py` FAIL on v1.0.7 output, PASS
      now.
- [x] Backend 467 passed, 1 skipped; ruff clean; frontend lint, type-check,
      `npm test`; production frontend build OK (on this machine it needs the
      Norton CA as the `extra_ca` build secret since 2026-10-18; CI doesn't).
- [x] ui-check: `layout-parity` 54/54 (3 line styles x 3 looks x 2 sizes x
      16:9, 9:16, 1:1, a manual-break caption included); `line-styles` 15/15;
      export list labels and badge at 375/1440 x light/dark; axe 0.
- [x] GPU E2E on the final code: soup-169 and soup-916 x en, hi, es ALL
      PASSED, then every line style exported (MP4, SRT, VTT) for all six: 0
      failures. Hinglish clip x en, hi, mr, es: both quality checks pass.
- [x] By eye: a burned MP4 frame per line style in 16:9 and 9:16 (en, hi);
      Hindi and Marathi SRTs and burned frames; the editor timeline for
      Hindi and Marathi before and after (phrase blocks on the waveform, no
      flicker gaps, no stretched words).
- [x] Docs: PRD, DESIGN_SYSTEM, API, DATABASE (migrations 15-17),
      ARCHITECTURE, TESTING; CHANGELOG 1.0.8.
- [x] Test videos: 43 created in the dev stack this release (7497-7539,
      ids recorded as made), all deleted through the API; it holds only 7426 (Tanush's). None created
      in the installed app. The installed app kept port 3000 throughout (dev
      UI on 3001); dev stack stopped at the end.

### Release check (2026-10-19)
- CI green on 236b9ce; `release.yml` 4/4 green; 8 assets, all 7 match
  SHA256SUMS; 1.0.8 images fetch anonymously (200).
- Backup per DATABASE.md §7 before the update (31 s downtime):
  `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.0.8` (vcm.dump, vcm-media.tgz
  284 MB, .env copy, rowcounts: 1 video, 76 captions, 5 exports, 1 style,
  caption-text md5). Kept until Tanush confirms.
- `vcm update` (Windows GPU) in 27 s: VCM_VERSION 1.0.8, alembic
  `a4d8e2c6f130` (head); rows and caption-text md5 unchanged; the style
  became Balanced / 2 words; the 5 older exports carry no language (made
  before it was recorded); video 84 gets stored word timings at its next
  transcription. Download **7.4 MB**: backend CUDA 4/15 layers, 0.2 MB;
  frontend 4/10 layers, 7.2 MB.
- Guard: own origin 200 at localhost and 127.0.0.1; other origin,
  cross-site, rebinding Host 403. `flow.js` PASS at both addresses.
- E2E on the install (GPU): soup-169 x same,hi,es and soup-916 x hi ALL
  PASSED; `timing_check.py` (fed on stdin) passes on its output. Test videos
  85-88 deleted (85 and 87 by flow.js, 86 and 88 through the API); the
  install holds only video 84 again.
- Secrets: none in history or images (public CA bundles only).

### Next
- Tanush: confirm the updated install; then the pre-1.0.8 backup is deleted
  and v1.0.9 starts.
- Translation quality into Indian languages (M2M100) is unchanged; a model
  switch is Tanush's call.

## v1.0.7 (released 2026-10-17, tag on 4064dc1)
Brief: fix caption dragging, the drag handle and the style sliders; improve
translation quality; add 12 caption languages. Definition of done and rules
are in Tanush's brief of 2026-10-15; this section is the resume point.

### Backlog
- [x] A1 Caption drag on the video: reproduce in Playwright (mouse, touch,
      1440/375), fix, test. (Keyboard is A4; themes in the D screenshots.)
- [x] A2 Drag handle "dot": there is no dot today (the whole frame is the
      drag surface). Add one per the brief (>= 24x24 hit area, on top, starts
      a drag, touch), test.
- [x] A3 Style sliders (opacity and the rest): reproduce, fix, test.
- [x] A4 Keyboard placement: arrow keys move a focused caption, Shift = far.
- [x] A5 Burn test: rendered MP4 caption position and opacity match preview.
- [x] B1 Translation sweep, all pairs of en/hi/fr/de/nl through M2M100
      (and Gemini if a key is set): script, completeness, punctuation, wrap.
- [x] B2 Fixes without changing models (context, wrapping, script/fonts).
- [x] B3 Record a sample per pair and the weak pairs.
- [x] C1 Verify M2M100's language list for bn pa mr gu ta kn ml te es pt it ru.
- [x] C2 Quality check per new language; reject unusable ones.
- [x] C3 Fonts: burn-in per new script (fonts-noto-core already has
      Bengali, Gurmukhi, Devanagari, Gujarati, Tamil, Kannada, Malayalam,
      Telugu; Cyrillic/Latin via DejaVu/Noto).
- [x] C4 Searchable language pickers (language step, editor, settings) with
      native + English names.
- [x] C5 Backend config/validation, API, frontend, tests, PRD, README.
- [x] C6 ROADMAP: Arabic, Urdu (RTL), Chinese, Japanese, Korean (CJK).
- [x] D  DoD checks: suites, E2E on GPU (new Indian + European), burn per
      language, screenshots + axe, docs, CHANGELOG v1.0.7.

### Decisions
- A3: controls that don't apply (outline/shadow colour with a box or at 0,
  box colour and padding without a box) stay visible and disabled, instead
  of appearing and vanishing. Hint line under them says why.
- A2: the handle follows the mockup (video_caption_editor_3: a grip on the
  caption's top edge): a 28x28 round button with a grip icon, always shown
  (touch has no hover), at the anchor's point of the top edge, pushed down
  just enough to stay whole at the top of the frame. A click on it focuses
  it and does not play/pause; the rest of the frame still drags and still
  plays on click.
- A4: arrow keys move the focused handle 1% of the frame, Shift 10%,
  clamped like a drag and saved through the same debounced update.
- The transport shortcuts (arrows seek 5 s, space plays) now ignore a key a
  focused control already handled (`defaultPrevented`).
- B2: captions that form one sentence are translated together and split
  back over the same captions (word boundaries, preferring punctuation within
  two words). Timings unchanged. Decoding capped at 3x the source tokens + 10
  and no repeated 4-grams.
- B (Gemini): a key is set on dev, but all 31 sweep requests failed with 429
  RESOURCE_EXHAUSTED (and some 503/504). Changing the Gemini model is
  Tanush's call, so Gemini was not swept; the app falls back to M2M100 and
  says so. Raise in the final report.
- C1/C2 language decisions (M2M100 1.2B, two 8-line texts: a cooking clip
  and a general "set up the app" text, each round-tripped to English):
  added bn mr ml ta es pt it ru; rejected te (not in M2M100's 103 language
  tokens, either model), kn gu pa (clearly unusable, samples below). Done
  under the brief's own rules (unsupported / unusable → don't add, report).
- Editor checks live in `scripts/ui-check/checks.js` (Playwright against a
  running app, like the existing checks); they need a completed video and
  reset its style before and after. `VCM_CHECK_VIDEO` picks the video.

### Done
- A3 sliders, two root causes, both reproduced in Chromium:
  1. **Controlled value lagged the event.** The slider's value came from the
     query cache, which re-renders on react-query's schedule (~150 ms on the
     dev editor), not inside the input event. React restores a controlled
     input to its prop as soon as the event returns, so a click or arrow key
     snapped the thumb and the number back, then forward. Fix: the slider
     owns its displayed value (set in the event), synced from the style
     whenever that changes.
  2. **Layout reflow under the pointer.** Dragging Opacity off 0 removed the
     outline/shadow colour swatches above it in the 2-column grid; the slider
     jumped 68 px (1440) / 136 px (375) mid-drag, the browser read the
     pointer as 0, the swatches came back: 6,0,17,0,28,0... Fix: keep them
     mounted, disabled.
  Check `style-sliders` (both widths, every slider: drag monotonic and stays
  put, click, arrow step, label, live preview, save + reload): 35 FAIL before,
  4 with fix 1 only (Opacity moves), 0 after (92 PASS).
- A1 drag, two root causes in the free-placed caption box:
  1. **Width depended on `left`.** An absolute box shrinks to the space
     between its left edge and the frame's right edge, so the caption
     rewrapped as it moved (133x130 near the middle, 413x33 at the left,
     207x98 at the right). The clamp used the size measured at grab, so it
     overflowed the frame by up to 115 px. libass wraps only at the margins
     under `\pos`. Fix: `width: max-content` (wrap at maxWidth only).
  2. **Baseline strut.** In free mode the box was a block, so the
     inline-block text sat on a line with descender room: the box was taller
     than the text and the text centre sat above `\an5\pos`'s point. Grab
     jumped ~1.7 px; the saved y was off by 0.009 of the frame (375 px).
     Fix: the box is a flex container, like anchored mode.
  Check `caption-drag` (mouse + CDP touch, 1440/375, 16:9 and 9:16): 17 FAIL
  before, 0 after (56 PASS per video).
- Found while testing A1: **Reset and presets kept a dragged position.**
  `default_style_fields()` read defaults off the columns and skipped
  nullable columns without one (`pos_x`/`pos_y`, `default=None` is "no
  default" to SQLAlchemy), and the presets copied that set. So "Back to
  defaults" and every preset left a hand-placed caption where it was, even
  though each preset names its own `position`. Fix: nullable columns default
  to None; presets clear `pos_x`/`pos_y`. Test
  `test_reset_and_presets_clear_a_hand_placement` (failed before).
- A2/A4 handle and keyboard. Found on the way:
  1. **First drag frames didn't move a caption vertically.** Until the
     cache re-rendered (~150 ms on dev) the box was still the full-bleed
     anchored container, and writing `left`/`top` to it shrank the container
     while the caption stayed pinned to its bottom. `applyFreePosition` now
     writes the whole free-mode box.
  2. **Arrow keys on the handle also seeked the video 5 s** (window-level
     transport shortcuts skip only text fields). Fixed as above.
  3. **Quick key presses were lost**: each press measured pixels that hadn't
     re-rendered yet. Presses now build on the last position sent.
  4. **Checks measured the wrong caption** right after a seek (the overlay
     shows the old one for a moment): the checks now wait for the caption
     that belongs to the seek time.
  Checks `caption-handle` (hit area, not covered, mouse/touch drag with no
  jump, handle follows, whole at the top, click focuses without playing) and
  `caption-keyboard` (1%/10% steps, clamped, saved, no scroll, no seek,
  keeps focus): both FAIL on the old code (no handle); all four caption
  checks + sliders: 202/202 (16:9) and 201+1 → 202/202 (9:16) after.
- A5 burn test `test_burned_caption_sits_where_the_preview_puts_it`: renders
  a white box at pos (0.3, 0.25) on a black clip through the real export
  task and measures the decoded frame. **It found an export bug:** at
  BorderStyle 3 libass paints the box with OutlineColour, and we sent the
  box colour/opacity in BackColour. Every burned box was the *outline*
  colour (black by default) at 100%, whatever Box colour and Opacity said;
  the YouTube preset's 75% box rendered solid. The default (black box,
  black outline) hid it. Fix: OutlineColour = box colour at box_opacity when
  boxed. After: box centre (0.299, 0.249) for (0.3, 0.25); opacity ratio
  0.6 within 0.03. Failed before ("no box was drawn"), passes after.
  Backend 352 passed, 1 skipped; ruff clean.
- B1/B3 sweep (all 20 pairs of en/hi/fr/de/nl + en→11 new, local 1.2B on
  dev CPU, 27 s and 41 s). Sample = the split sentence "Then add the
  tomatoes, a little salt, | and a cup of water.", after B2:
  | Pair | Sample | Verdict |
  |---|---|---|
  | en→fr | Puis ajoutez les tomates, un peu de sel \| et une tasse d'eau. | good |
  | en→de | Dann die Tomaten, ein wenig Salz und eine \| Tasse Wasser hinzufügen. | good; split inside a phrase |
  | en→nl | Voeg dan de tomaten toe, een beetje zout \| en een kopje water. | good |
  | en→hi | फिर टमाटर, थोड़ा नमक और एक गिलास \| पानी जोड़ें। | weak (onions→"apples/soap", fry→"freeze", thick→"fat") |
  | fr→en | Then add the tomatoes, a little salt, \| and a cup of water. | good; idioms literal ("faites-les revenir"→"turn them back") |
  | fr→de | Dann fügen Sie die Tomaten, ein wenig Salz und eine \| Tasse Wasser hinzu. | good; same idiom |
  | fr→nl | Voeg vervolgens de tomaten, wat zout en een \| kopje water toe. | good; same idiom |
  | fr→hi | फिर टमाटर, थोड़ा नमक और एक कप \| पानी जोड़ें। | weak (as en→hi) |
  | de→en | Then add the tomatoes, \| some salt and a cup of water. | good |
  | de→fr | Ensuite, ajouter les tomates, \| un peu de sel et une tasse d'eau. | good |
  | de→nl | Voeg vervolgens de tomaten, \| wat zout en een kopje water toe. | good |
  | de→hi | फिर टमाटर, \| कुछ नमक और एक कप पानी जोड़ें। | weak (as en→hi) |
  | nl→en | Then add the tomatoes, a little salt \| and a cup of water. | good |
  | nl→fr | Ajouter les tomates, un peu de sel \| et une tasse d'eau. | good |
  | nl→de | Dann fügen Sie die Tomaten, ein wenig Salz \| und eine Tasse Wasser hinzu. | good |
  | nl→hi | फिर टमाटर, थोड़ा नमक और एक \| कप पानी जोड़ें। | weak (as en→hi) |
  | hi→en | Then add tomatoes, \| a little salt and a cup of water. | weak as a source (प्याज़ "onion"→"pieces", गाढ़ा "thick"→"hot") |
  | hi→fr | Puis versez des tomates, \| un peu de sel et une tasse d'eau. | weak source (as hi→en) |
  | hi→de | Dann Tomat, ein wenig Salz \| und eine Tasse Wasser gießen. | weak source; "Töpfe" (pots) for onions |
  | hi→nl | Voeg dan tomaten, \| een beetje zout en een kopje water toe. | weak source (as hi→en) |
  | en→es | Luego añade los tomates, un poco de sal \| y una taza de agua. | good |
  | en→pt | Em seguida, adicione os tomates, um pouco de \| sal e uma xícara de água. | good; split inside a phrase |
  | en→it | Poi aggiungere i pomodori, un po 'di sale \| e una tazza d'acqua. | good (apostrophe spacing) |
  | en→ru | Затем добавьте помидоры, \| немного соли и стакан воды. | good |
  | en→bn | এরপর টমেটো, সামান্য লবণ এবং একটি \| কাপ পানি যোগ করুন। | weak: everyday text 7/8 right; cooking nouns wrong (onions→"soap", fry→"cool") |
  | en→mr | थोडा काढलेला टोमॅटोचा गर आणि थोडी साखर घालून \| मिश्रण एकत्र करावे. | weak: everyday 8/8; cooking 4/8 (onions→"sugar", fry→"freeze") |
  | en→ml | അതിനുശേഷം ഒരു കുപ്പി വെള്ളം, \| കുറച്ചു മുളപ്പവും ചേർക്കുക. | weak: everyday 7/8; cooking 3/8 ("a bottle of water", eggs) |
  | en→ta | பின்னர், மழை பெய்யும், \| சிறிது தண்ணீர் சேர்க்கவும். | weakest added: everyday 6/8 (one English word left); cooking 3/8 ("rain", first line "Return of Christ's sister") |
  | en→pa | ਪਾਲਤੂ ਦੋਸਤਾਨਾ ਜਾਨਵਰ ਲਈ ਤਿਆਰ ਕੀਤਾ ਗਿਆ ਹੈ, \| ਜੋ ਕਿ ਇੱਕ ਛੋਟੇ ਫੀਚਰ ਹੈ. | REJECTED: "designed for pet friendly animals"; everyday 3/8, one line reverses its meaning ("videos can be removed at any time") |
  | en→gu | આ ઉપરાંત, તમે એકાઉન્ટ્સ, બ્રોડબેન્ડ્સ અને ફ્લેટ્સને \| ડાઉનલોડ કરી શકો છો. | REJECTED: "you can download accounts, broadbands and flats"; crawl junk "આ પણ વાંચો:" (Read also:), English copied |
  | en→kn | ಕಲಬುರಗಿ ಸ 11:ಬರುವ ವರ್ಷದ ಅಕ್ಟೋಬರ್ 2 ರೊಳಗೆ… \| …ರಮೇಶ ಜಿಗಜಿಣಗಿ ಹೇಳಿದರು. | REJECTED: a remembered news story about sanitation (same paragraph on 3 captions) |
  Why weak: Hindi and the Indian languages are low-resource in M2M100; its
  training data is web crawl, which is where "Read also:" and the news
  paragraph come from. Weak pairs keep the script, timing and line count;
  nouns are what go wrong.
- B2 (`translation.py`): sentence grouping + split-back, decode guards.
  Before/after on the sweep: continuations no longer capitalised or given
  their own full stop ("Bis sie weich sind." → "bis sie weich sind."),
  German/Dutch verbs land at the end of the sentence they belong to ("Dann
  die Tomaten, etwas Salz | Add a cup of water." → "...| some salt and a cup
  of water."). Tests `tests/test_translation.py` (8; can't even import on
  the old code).
- C3 burn per language, found two export bugs (both older than v1.0.7):
  1. **No complex shaping in any burn.** FFmpeg's `subtitles` filter leaves
     libass on simple shaping: Hindi "मिलते" burned as "मलिते", conjuncts as
     bare viramas (धन्‌यवाद), Bengali "টমেটো" as "টমটে◌া" with a dotted
     circle, Malayalam ൊ/ോ split. Hindi exports have looked like that since
     v1.0. Compared side by side: `subtitles` and `ass:shaping=simple` broken,
     `ass:shaping=complex` correct, same fonts. Fix: the burn uses the `ass`
     filter with `shaping=complex`. Test `test_indic_scripts_are_shaped_in_the_burn`
     (renders कि, ि's hook must be left of क) failed before.
  2. **The preview drew every caption larger than the export.** libass
     sizes a face so its whole win cell is the font size; CSS sizes the em.
     The win span (already computed for catalogue fonts, never used) is 1.12
     for Liberation Sans and 1.76 for Poppins Bold, so a Poppins caption was
     1.76x larger in the editor, wrapping differently. Measured preview vs
     burn on dev, before → after: Poppins ~1.76 → width ratio 1.008, height
     0.964; Liberation Sans → 1.001 / 0.972; Lato → 0.993 / 0.985 (height
     differences are anti-aliasing at the threshold). Fix: the style serves
     `font_win_span`; the preview's font-size is size x scale / span and its
     line-height is the span (libass's line pitch). Check `caption-size`;
     A5 test pins box height = cell + padding.
  Fonts: libass found every glyph in all 13 languages (no "fallback" or
  "glyph" warnings), via fonts-noto-core (Bengali, Tamil, Malayalam Noto
  Sans Bold) and Poppins (Devanagari); after the shaping fix all 13 render
  correctly (`all-langs` sheet checked by eye).
- C3 script fonts: Indic text was drawn by two different fallbacks — libass
  picked Poppins (Devanagari) or Noto (the others) and sized it by the
  *fallback's* win span; the browser used the OS (Nirmala UI on Windows) at
  the caption font's em. Now both use Noto Sans Devanagari/Bengali/Tamil/
  Malayalam, vendored in frontend/public/fonts (byte-identical to the
  image's fonts-noto-core 20201225, OFL, 1.25 MB): ASS wraps each script run
  in `\fn<Noto>\fs<size x noto span / caption span>` so its em is the caption
  font's; CSS lists the faces first with `unicode-range`. Measured Hindi
  caption, preview vs burn: Poppins w 0.985 / h 1.014, Sans w 1.014 /
  h 1.013. Tests: `test_indic_runs_get_their_own_font_at_the_caption_fonts_em`,
  `test_indic_text_is_burned_at_the_caption_fonts_em` (ratio 1.0 before,
  0.634 = span ratio after); check `script-fonts` (CDP: which font drew the
  glyphs).
- B2 line wrapping: libass (WrapStyle 0) balances a wrapped caption's lines,
  the browser filled them greedily, so the preview broke lines elsewhere.
  Measured, a 2-line caption as fractions of the frame: burn 0.609 + 0.635,
  preview 0.863 + 0.375, preview with `text-wrap: balance` 0.601 + 0.633.
  Applies to every language; Indic scripts wrap at spaces like the others.
  Check `caption-wrap` (min/max line width 0.52 before, 0.90 after).
- Cyrillic, found in the GPU E2E burns: Russian in Poppins (the default,
  no Cyrillic) burned ~1.3x the size of the Latin around it (libass sized
  its Noto fallback by Noto's span). Now Noto Sans (vendored, 1 MB) draws
  Cyrillic in both renderers at the caption font's em, **only** for a
  caption font without Cyrillic (fc-query charset: Poppins, Anton, Bebas
  Neue, Barlow Condensed lack it; Lato, Liberation, DejaVu keep their own).
  The style serves `script_font_stack` for the preview. Russian caption,
  preview vs burn width: Poppins 0.993, Lato 0.999. Tests
  `test_cyrillic_gets_noto_only_when_the_caption_font_has_none`,
  `test_cyrillic_is_burned_at_the_caption_fonts_em` (both fail without).
- Wrap limit found on the 9:16 run: at size 130 a caption wrapped to 7
  lines, and Chrome's `text-wrap: balance` only balances up to 6 (libass any
  number). Known limitation (PRD §10); `caption-wrap` now checks 2-3 lines
  (0.90 on 16:9, 0.87 on 9:16) and that balance is applied.

### Caption box (reopened 2026-10-17, release held)
Brief: caption placement still wrong (right edge wraps to one word per line,
left/top cut off, bottom with padding 0 overflows). Replace it with a box of
its own width, Max lines with a font shrink, the centre as the position, a
3% safe area for the whole painted box, snapping, one layout rule shared by
the preview and the burn, and a migration for old styles.

Where the screenshots came from: the one-word-per-line wrap at the right
edge is 1.0.6 behaviour (the installed app was 1.0.6; v1.0.7's
`width: max-content` had removed it). The rest reproduced on the v1.0.7
code in the dev stack (scratch Playwright, box padding 0/40, outline +
shadow, 16:9 and 9:16): the box was clamped by its *text* rectangle to the
frame edge, so at the left and top the padding, outline and shadow were
outside the frame (text at 0.0 px from the edge), and at the bottom with
padding 0 the outline overflowed. libass placed and wrapped by its own
rules (anchor + margins, or `\pos` + MarginL/R), the browser by its own.

- [x] B1 One layout rule: `services/caption_layout.py` (HarfBuzz widths on
      the files libass uses) and its line-for-line copy
      `lib/caption-layout.ts` (canvas `measureText`). Box width (default
      0.80 landscape/square, 0.85 portrait), balanced wrap, long words broken
      at cluster boundaries, Max lines shrink in 2% steps to 70% then one
      extra line, centre, slide into the 3% safe area by the painted
      rectangle (padding or outline, shadow, 0.1 em glyph overhang + 2 px
      antialiasing, measured). The ASS gets `\an5\pos`, `\fs` and `\N`
      lines per event, WrapStyle 2, zero margins.
- [x] B2 Model + migration `c8f2a6d41e93`: `box_width`, `max_lines`;
      `pos_x`/`pos_y` = box centre, NOT NULL; `position`, `margin_v`,
      `margin_h` dropped. Conversion tested (anchored top-left, boxed
      bottom, centred and left-aligned hand placements).
- [x] B3 Editor: overlay draws the layout (lines as blocks, `white-space:
      pre`), width handles on the box's edges (mouse, touch, keys), snapping
      with guides, safe-area guides, readout; Position tab: Placement,
      Alignment, Max width, Max lines.
- [x] B5 Burned box drawn, not BorderStyle 3: by eye the four-corner burns
      showed a Hindi box as a row of overlapping translucent boxes (libass
      boxes each font run; each Hindi word is a run in its script font).
      Now a `\p1` rectangle of the layout's size on layer 0 under the text.
      Test `test_a_translucent_box_is_one_even_rectangle` (box levels 243 to
      255 before, one level after).
- [x] B4 Tests: `test_caption_layout.py` (grid in the layout and in burned
      pixels, 48 tests), `test_caption_styles.py` (round trip, bounds,
      nulls, presets/Reset, migration); ui-check `caption-safe-area`,
      `caption-width`, `caption-snap`, `layout-parity`, and the existing
      caption checks moved to the safe area.

Decisions (not covered by the brief, made here):
- **The layout is computed by us, not by either renderer** (DECISIONS D16).
  The browser copy is checked against the backend by `layout-parity` rather
  than fetched per frame, so width handles stay live.
- **A drag saves the centre it asked for, kept inside 0..1**, not the
  clamped one: a caption dragged against an edge saves "against that edge",
  and shorter captions sit against it too. Keys save the drawn centre, so a
  press against an edge never walks into a dead zone.
- **Width handles move both edges** (the centre stays), so dragging one
  edge doesn't also move the caption.
- **Snap distance 8 px** to the frame's centre lines; the safe area needs no
  snap (the clamp holds the box there) and shows a guide.
- **Top / Middle / Bottom at 12% / 50% / 88%** of the height. The default
  is Bottom (0.88); presets keep their own row.
- **Migration:** an anchored caption gets the centre of a one-line caption
  (margin + padding or outline + half the font size in from the edge); left
  and right alignment add half the default width (0.40); the side margin is
  read against 1920 px (the video's shape isn't stored). Existing captions
  get the default width (brief), so a caption that used nearly the full
  width may take one more line.
- **uharfbuzz goes in its own Dockerfile layer**, not pyproject.toml:
  changing pyproject/constraints rebuilds the deps layer, and every install
  would download 0.8 GB (CPU) or 2.3 GB (CUDA) on update for a 2 MB wheel.
  Fold it into pyproject.toml the next time dependencies change.
- **API:** a null on any NOT NULL style field is now a 422 (it was a 500);
  `box_width: null` means the default width.

Measured:
- `layout-parity`: preview lines identical to the burn's, rectangle within
  0.5% of the frame, 18/18 configurations (3 aspects x 3 looks x 2 sizes x
  5 texts).
- `caption-safe-area`: 36/36 (13 positions incl. 4 drags far outside x 5
  texts, per configuration).
- Burned pixels (`test_caption_layout.py`): every caption inside the safe
  area and inside its layout rectangle; a box's edges within 2.5 px (1% of
  the width for Devanagari, whose libass box is 0.8% wider than the
  HarfBuzz advances).

### Definition of done, caption box (2026-10-17)
- [x] Every test in the brief fails before and passes after: the grid in
      the layout and burned pixels (`test_caption_layout.py`), in the
      preview (`caption-safe-area` 36/36), width unchanged when dragged,
      handles and slider, Max lines and the shrink (`caption-width`), mouse,
      touch and keyboard (`caption-drag`, `caption-handle`,
      `caption-keyboard`, `caption-width`), parity (`layout-parity` 18/18).
- [x] Backend 415 passed, 1 skipped; ruff clean; frontend lint, type-check,
      `npm test` 3/3; production frontend build OK.
- [x] ui-check: 263/263 on 16:9 and 263/263 on 9:16 (after the check fix),
      54/54 read-only; axe 0 on the editor at 375/1440 x light/dark with the
      Position tab and the width handles showing.
- [x] GPU E2E (RTX 5080, CUDA dev image rebuilt with the uharfbuzz layer):
      soup-169 x same,hi,mr,ru,es,ml and soup-916 x same,hi,es, SRT, VTT
      and MP4 each: ALL PASSED.
- [x] Burned MP4 per corner, 16:9 and 9:16 (Hindi, box at 60%, width 50%),
      checked by eye: every box whole, 3% in from both edges, one even box.
- [x] Docs: PRD F5 and limitations, DESIGN_SYSTEM, DECISIONS D16, API,
      DATABASE (migration 14), ARCHITECTURE, TESTING; CHANGELOG v1.0.7.

### Definition of done (2026-10-17, before the caption box)
- [x] A, B, C done, each fix with a test that fails before (see Done).
- [x] Backend 369 passed, 1 skipped; ruff clean; frontend lint, type-check,
      `npm test` 3/3; production frontend build OK.
- [x] GPU E2E (RTX 5080, dev worker with the GPU override): soup-169 x
      same,en,hi,fr,de,nl,bn,mr,ta,ml,es,pt,it,ru, every one with SRT, VTT
      and MP4: ALL PASSED; after the Cyrillic fix, soup-916 x ru,hi,ml,es
      ALL PASSED. All translations ran locally (Gemini quota exhausted).
- [x] Burned MP4 per caption language: the 14 E2E exports stacked and
      checked by eye; shaping correct in every script, no missing glyphs.
- [x] Screenshots 375/1440 x light/dark: dashboard, settings, search,
      editor (16:9, 9:16, Russian), language step (plain and searched),
      editor language picker (open, searched), style panel with a box,
      caption handle focused; axe 0 everywhere, no console errors or
      overflow.
- [x] Docs (PRD, README, API, DATABASE, ARCHITECTURE, TESTING,
      DESIGN_SYSTEM, DECISIONS D14/D15, ROADMAP) and CHANGELOG v1.0.7.
- [x] Backlog empty. Installed app back on 3000, dev stack stopped.
- ui-check totals at the end: 216/216 (16:9), 216/216 (9:16 after the
  wrap check change), 54/54 read-only.

### Release check (2026-10-17)
- CI green on 4064dc1; `release.yml` 4/4 jobs green; Release has 8 assets,
  all 7 files match SHA256SUMS; backend 1.0.7-cpu/-cuda and frontend 1.0.7
  manifests fetch anonymously (200).
- Backup before the update, per DATABASE.md §7 (11 s downtime):
  `C:\Users\Admin\VideoCaptionMaker-backups\pre-1.0.7` (vcm.dump, vcm-media.tgz,
  .env copy, rowcounts-before.txt). Kept until Tanush confirms the update.
  The install held 0 videos at that point: video 79 was deleted from the
  dashboard in Tanush's browser at 14:26:41 (audit log), and its re-upload
  landed in the dev stack while that had port 3000, and was deleted there
  at his answer.
- `vcm update` (Windows GPU) in 25 s: VCM_VERSION 1.0.7, alembic
  `c8f2a6d41e93` (head), placement columns replaced, all containers
  healthy, data unchanged (0 videos, captions, exports, styles; the same 19
  media files). Download 11.8 MB: backend CUDA 9/15 layers 4.6 MB (venv
  2050 MB reused), frontend 4/10 layers 7.2 MB.
- Guard: own origin 200 at localhost and 127.0.0.1; other origin,
  cross-site and rebinding Host 403. `flow.js` PASS at both addresses.
- E2E on the install (GPU): soup-169 x same,hi,es and soup-916 x hi ALL
  PASSED; `caption-snap`, `caption-keyboard`, `caption-safe-area` on the
  install 48/48; axe 0. Test videos 80-83 deleted afterwards (80 and 82 by
  flow.js, 81 and 83 through the API); the install holds 0 videos again.
- Secrets: only the old `docs/learning-guide.md` in history (accepted);
  images hold only public CA bundles.
- Linux CPU install not updated (no CPU check required, as for 1.0.5/1.0.6).
- Dev stack cleanup: 43 soup/square test videos and 16 failed `clip.mp4`
  uploads deleted through the API; it holds only 7426.

### Next
- Tanush: confirm the updated install looks right; then the pre-1.0.7
  backup can be deleted.
- Gemini: the dev key's quota for the configured model is exhausted (429).
  Switching the Gemini model is Tanush's call.
- When the dependencies next change: move uharfbuzz from its Dockerfile
  layer into pyproject.toml/constraints.txt.
