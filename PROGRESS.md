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

## v1.0.8 (in progress)
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
- [ ] L1 Model + migration: `line_style` (auto/balanced/stacked, default
      auto), `words_per_line` (1-4, default 2); `max_lines` up to 6 (Stacked).
- [ ] L2 Layout (backend + frontend copy): Balanced, Stacked, manual breaks
      counted as lines, fit rule below 70% until the box fits the safe area.
- [ ] L3 SRT/VTT written with the layout's lines at the video's own size.
- [ ] L4 Redo keeps manual breaks on an exact match in the same language.
- [ ] L5 Style panel: Line style with descriptions, Words per line; Max lines
      range by style; keyboard and screen reader; axe 0.
- [ ] L6 Tests per the brief; parity per line style x 16:9, 9:16, 1:1.
- [ ] L7 Docs: PRD, DESIGN_SYSTEM, API, DATABASE, ARCHITECTURE, TESTING,
      CHANGELOG (Unreleased -> 1.0.8).
- [ ] L8 Suites, build, GPU E2E (en, hi + one more x each line style), a
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
