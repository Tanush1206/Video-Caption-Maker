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
- [ ] M12 End-to-end: real video, GPU and CPU, all 5 languages, export.
- [ ] M13 Fresh-install test from scratch in a clean environment.

### Added by Tanush (2026-10-08)
- [ ] R1 Prove no Norton/local CA is in any committed file, in a built image
      (inspect for *.crt), or in a release. Dev machine only.
- [ ] R2 Frontend `npm run build` + `npm run lint`: run and report.
- [ ] R3 Report the language pairs and engine the 12 E2E jobs covered. All 20
      pairs on local M2M100; a bad or missing Gemini key falls back without
      failing the job.
- [ ] R4 Test the low-RAM CPU tier (< 12 GB → small + M2M100-418M) with a
      memory-limited worker.
- [ ] R5 `vcm update` keeps videos, captions and the DB, and runs migrations.
- [ ] R6 Final install test from the published GitHub Release + GHCR images.
      Tell Tanush when to make the repo and packages public.
- [ ] R7 macOS untested: a known limitation in the README and final report.

### UI
- [x] U1 3-step flow (Upload → Language → Export) with a stepper; editor,
      styling and search become secondary ("Edit captions").
- [x] U2 Processing states: model download (size + %), transcribing (% + ETA),
      translating, rendering, done with a download link.
- [x] U3 No login or landing page in local mode; Settings gets a Gemini key
      field, a Whisper model override and hardware info; account UI hidden.
- [ ] U4 Consistency pass: spacing and type scale, buttons, inputs, cards,
      overflow.
- [ ] U5 Responsive at 375px through wide desktop; light and dark.
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

## Next
Rebuild images (Noto fonts, xet off, CA env), `vcm update` on the GPU install,
finish the CPU E2E in the clean machine, a final screenshot pass (U4/U5), the
`vcm stop/start/uninstall` tests, then the final DoD check.
