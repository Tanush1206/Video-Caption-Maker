# Changelog

All notable changes to VideoCaptionMaker. Versions are the git tags. Dates
are when the GitHub Release was published. Each entry is drawn from the
commits between tags; hashes are given for reference.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed
- **A caller could forge `audit.log`'s client address through the UI
  port.** Next's `/api` proxy passed a caller's `X-Forwarded-For` (and
  `-Proto`) to the API, which trusts the frontend. The frontend now
  overwrites both with its own socket's peer before proxying
  (`frontend/forwarded-for.js`). For a browser on the same computer, that
  peer is Docker's gateway. Tested in `frontend/tests/`, which CI now runs
  (`npm test`).

## [1.0.5] - 2026-10-14

Updating from 1.0.4 downloads about 6.3 MB (backend 0.2 MB, frontend
6.1 MB), measured on both test installs. No migration.

### Added
- **System theme** in Settings → Interface theme (Light / Dark / System, the
  default). It follows the OS, including a change while the app is open
  (`2c0f020`).
- **The app's own 404 page** for unknown addresses, with a way back to the
  videos (`fc402f7`).
- **"Retry with small model"** on the failed screen. It sets the speech model
  to small with the existing Settings API, then retries the video (`87aa211`).
- **Backend lint and tests in CI**: ruff (`backend/ruff.toml`) and the full
  pytest suite against Postgres, Redis and ChromaDB service containers
  (`6f1fe9d`).
- **`scripts/ui-check/`**: the screenshot, axe-core and UI-flow harness, plus
  named behaviour checks (`73be0c8`, `3206d9f`, `13b9403`).
- **Documentation:** `docs/` (PRD, ARCHITECTURE, DATABASE, API, SECURITY,
  ENVIRONMENT, DESIGN_SYSTEM, CODE_STYLE, TESTING, DECISIONS, ROADMAP;
  the original plan is now MILESTONES), this changelog, `AGENTS.md` and
  `CLAUDE.md`.

### Changed
- **The API reports the release version** (`VCM_VERSION`) instead of
  `0.1.0` (`369a30e`).
- **Forwarded headers are believed only from the frontend container**
  (`TrustedProxyHeaders`, uvicorn `--no-proxy-headers`), not from any caller
  (`3a418bf`).
- **Google Fonts download from a pinned commit** of `google/fonts`, the one
  the catalogue was built at. Six catalogue fonts had moved on `main` and
  failed to download (`2aabf29`).
- **The dev stack builds the CPU image by default**; `VCM_VARIANT=cuda` plus
  `docker-compose.gpu.yml` for the GPU, as in the installed app (`2089492`).
- **The upload limit defaults to 4096 MB** in the code, matching installs
  (`b63ed42`, `7e7ed6f`).
- **The test suite runs on its own stores**: a `_test` database rebuilt from
  migrations on every run, Redis db 14, the `captions_test` collection and a
  temp directory. It never touches the dev database (`62bf07a`).
- **Removed unused settings** `STORAGE_BACKEND`, `MODEL_CACHE_DIR` and
  `S3_*`. `.env.example` now asks for a 64-hex `JWT_SECRET_KEY` and no longer
  offers `GEMINI_API_KEY`, which is set in Settings (`d270caf`).

### Fixed
- **The editor's Redo disabled Hindi, French, German and Dutch** unless a
  Gemini key was in the environment, although they translate locally. All
  five are now offered offline, and `translation_available` is always true
  (`160781f`).
- **Deleting a video left its export files on disk** (`3fd56b2`).
- **The Gemini key could appear in the dev backend log**: SQL echo printed
  bound values when the key was saved. Both database engines now hide
  parameters (`f2e9ca6`).
- **`/api/ask` without a Gemini key** answered "I couldn't find an answer…"
  when nothing matched. It now always says that written answers need a key
  (`bde0889`).
- **Celery's 30/35 min time limits removed.** They never fired under
  `--pool=solo`, but would have cut long transcriptions and 3 h renders
  short under any other pool (`17367ff`).
- **The light-theme "Failed" badge failed AA contrast** (3.82:1). Destructive
  is now rose-700 (`eb1c345`).

## [1.0.4] - 2026-10-12

A visual redesign. **No behaviour changed**, and no backend, installer or
compose file changed, so updating from 1.0.3 downloads only the frontend's
three app layers (6.1 MB; 0 of 14 backend layers).

### Changed
- New design tokens from the Stitch DESIGN.md (`e0eae23`):
  - a slate base with one indigo accent;
  - an 8 px radius everywhere;
  - the Geist UI font, bundled with `next/font/local`;
  - a fixed-px type scale.
- App shell (`022a396`):
  - a segmented section nav;
  - host and worker-hardware chips;
  - a footer;
  - a bottom tab bar on phones.
- Dashboard (`60b07cb`, `87fa9ae`): stepper bar, a hero drop zone, project
  cards in a grid or list view with a name filter, and first-run step cards.
- Language step (`8dd98f9`): caption languages as radio cards, each in its
  own name; the spoken language is stated, not asked.
- Processing and failed states (`3ad3d1d`): the worker's stage list
  (done/active/queued). The model-download card now appears only for a real
  download.
- Editor (`cfbda0c`, `e4b1412`):
  - an editor bar (title, length, languages, Export) and two columns with the
    transcript pinned right;
  - a phone bottom bar;
  - the style studio as Typography/Appearance/Position tabs;
  - "Check this line" on low-confidence captions.
- Export moved into a dialog (`db5741c`): five format cards, file name,
  resolution, render progress and previous exports.
- Search (`64fc9b6`): results grouped by video, with a preview panel.
- Settings (`c51dad9`): hardware, model cards, the translation engine in use,
  disk and theme.

### Fixed
- Medium primary buttons had dark labels. tailwind-merge read `text-body-md`
  as a colour and dropped `text-primary-foreground`; the type scale is now
  registered with `extendTailwindMerge` (`8dd98f9`).
- WCAG AA contrast (`87fa9ae`):
  - filled buttons `#5B5EF0`/`#4F46E5`;
  - dark indigo text `#818CF8`;
  - light muted text slate-600;
  - inline links underlined.
  
  axe-core reports 0 violations on all screens in both themes.

## [1.0.3] - 2026-10-12

### Added
- **Request guard** for local mode (`491ebee`):
  - it refuses requests addressed to a non-local host (DNS rebinding, reads
    included), cross-site state changes, and state changes from another
    origin;
  - every refusal, DELETE and settings change is appended to
    `storage/audit.log`, without request bodies;
  - the log rotates at 5 MB.

### Changed
- **Updates no longer re-download the whole image** (`949fe9d`):
  - the version `ARG`/`LABEL`/`ENV` moved to the end of both Dockerfiles;
  - CI builds use a GHCR registry cache instead of the Actions cache.
  
  The 1.0.2 → 1.0.3 update itself was still a full download, once.

### Fixed
- The guard's allowed origin is now the install's own address and port, taken
  from the forwarded host (`72ea1fa`). The production compose never set
  `CORS_ORIGINS`, so `http://localhost:3000` had been trusted on every
  install, including installs on another port. A `null` origin is refused.
- The starting worker now takes over the video and export jobs the dead
  worker held unacknowledged in Redis (`02a4576`). Before, they were
  redelivered after an hour, outside the requeue counter.

## [1.0.2] - 2026-10-11

### Added
- `recovery_attempts` on videos and exports (migration `b4e7c2d91a36`,
  `8c4a461`).

### Fixed
- A job in flight during a restart no longer stays "processing" forever. The
  worker requeues stranded jobs when it starts (`8e137c0`).
- A job that keeps crashing the worker (out of memory) is failed after
  **3 automatic requeues**, with "…choose a smaller speech model…", instead
  of looping forever (`98202fe`). A manual retry resets the count.

## [1.0.1] - 2026-10-08

### Added
- `install.sh`, `install.ps1` and `vcm update` verify every downloaded file
  against the release's `SHA256SUMS` before replacing anything (`d0fb999`).

### Fixed
- The delete-data uninstall now also removes Redis's anonymous volume
  (`95f5952`).

## [1.0.0] - 2026-10-08

The first installable release. The app's features (upload, transcription,
caption editor with timeline and styling, export and burn-in, semantic
search, dashboard) were built in Milestones 1–10; see `docs/MILESTONES.md`.

### Added
- **One-command install** (`de8a875`):
  - `install.sh` (macOS/Linux) and `install.ps1` (Windows) check Docker, the
    GPU and the disk;
  - they generate secrets, pull, start, wait for health and open the
    browser;
  - the `vcm` command provides start, stop, restart, status, logs, update,
    open and uninstall.
- **Production images** (`f594b6d`, `e589f67`):
  - a multi-stage backend with `cpu` and `cuda` variants, with the CUDA
    libraries moved to an extra (CPU image 7.3 → 3.5 GB);
  - a standalone Next.js frontend;
  - no certificates, dev dependencies or source in either image.
- **Production compose** `docker-compose.prod.yml` (project `vcm`) and
  `docker-compose.gpu.yml` (`4384ff2`):
  - pinned images and named volumes;
  - healthchecks on every service;
  - only the UI port, and only on 127.0.0.1.
- **Release workflow** to GHCR with GitHub Release assets, plus a CI workflow
  (`90cc5d4`).
- **Local mode** (`8ca8596`, `bc4f74a`): one automatic user, no login, no
  landing page and no account menu.
- **Hardware tiers** (`aa8e80e`): Whisper `large-v3` on GPUs with ≥ 6 GB
  VRAM, `large-v3-turbo` on CPUs with ≥ 12 GB RAM, `small` otherwise. The
  choice can be overridden in Settings or with `WHISPER_MODEL_SIZE`.
- **Local translation** with M2M100 1.2B/418M (CTranslate2 int8, pinned
  commits). Gemini is used only when a key is set, and falls back to local
  with a notice (`dc77d43`, `7ac5f51`).
- **Settings page** (`9e4a046`, `9ab2721`, `4d820e1`): the detected
  hardware, the speech model choice, and an optional Gemini key that is
  stored server-side and never returned.
- **Upload → Language → Export flow** with a stepper; the caption language
  travels with the upload (`959f113`). Processing states show the model
  download size and progress, the stage, % and ETA (`7d7d1a1`).
- **Retrieval-only search** without a Gemini key (`fd4e793`).
- **Same-origin `/api` proxy** through Next, so an install exposes one port
  (`fd7a368`, `52b0e45`).
- **Spoken and caption language choice**, large-v3 by default, cached models
  (`b79c442`, `1cf1c99`, `6c633f4`).
- **Styling and export features:**
  - Poppins as the default caption font and free caption placement
    (`ab7fae9`);
  - instanced Google Fonts (`f3917c3`, `41e0a60`);
  - export output height (`c3569fd`);
  - user-named downloads (`f5a1acd`).
- `scripts/e2e.py`, an end-to-end driver for a running install (`ee7cdf7`).

### Changed
- Model downloads use plain HTTP (`HF_HUB_DISABLE_XET=1`), so progress is
  visible and downloads resume (`27f9555`).
- Failures show sentences instead of raw errors (`c8f206f`).
- The README was rewritten for end users (`80ef32a`).
- Unused dev tools and empty scaffolding were removed (`83c9e96`).
- Builds and every runtime client trust an optional proxy CA: a BuildKit
  secret at build time, and the `certs/` folder plus `SSL_CERT_FILE` at
  runtime (`fc3b6da`, `f5f1263`).

### Fixed
- Long Whisper segments are split into readable captions of ≤ 84 characters
  or ≤ 6 s (`816bfa1`).
- Noto fallback fonts were added for scripts the caption font lacks, so Hindi
  burns in (`9cc69c0`). DejaVu is installed explicitly (`5a897db`).
- A transcription where nothing passed the no-speech check (the small model
  on Hindi) now retries without it and adds a notice (`b8c446a`).
- Uninstall removes only the app's own images. `chromadb/chroma:1.0.0` is
  shared with other projects. `vcm status` shows stopped containers
  (`07f0326`).
- Light-theme success and warning text pass AA (`ed92c0f`).
- The dev compose mounted Chroma at `/chroma/chroma`, but Chroma 1.x persists
  to `/data`, so dev vectors were lost on recreate. Both compose files are
  fixed (`4384ff2`).

[Unreleased]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Tanush1206/Video-Caption-Maker/releases/tag/v1.0.0
