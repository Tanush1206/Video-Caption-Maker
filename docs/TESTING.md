# Testing

How VideoCaptionMaker is tested, as of v1.0.4: what exists in the repo, the
commands, and the manual procedures recorded in PROGRESS.md for the things
automated tests can't reach (GPU, installers, updates).

## 1. Layout and tools

| Layer | Tool | Where | Runs in CI |
|---|---|---|---|
| Backend unit and integration | pytest 8 + pytest-asyncio (`asyncio_mode = auto`, **one session-wide event loop**) + httpx `ASGITransport` | `backend/tests/` (15 files, ~290 test functions; PROGRESS.md records 325 passed with parametrisation) | **no**: needs Postgres, Redis, ChromaDB and FFmpeg, so it runs in the dev stack |
| Frontend static checks | `next lint` (`next/core-web-vitals`), `tsc --noEmit`, `next build` | `frontend/` | yes (`ci.yml`, job `frontend`) |
| Installer scripts | `bash -n`, `shellcheck -S warning`, `docker compose config -q` for both compose files | `install/`, compose files | yes (`ci.yml`, job `scripts`) |
| End to end | `scripts/e2e.py` (stdlib only) | against a running install or dev stack | no (manual) |
| UI screenshots and accessibility | Playwright (Chromium) + axe-core | **not committed** (see Open questions) | no (manual) |
| Update download size | `scripts/update_layers.py` | against GHCR | no (manual, at release) |

There are **no frontend unit tests**.

### Backend test conventions (`backend/tests/conftest.py`)

- **The suite runs in accounts mode.** `AUTH_MODE=accounts` is set before the
  app is imported, so registration, JWT and refresh are exercised. Local-mode
  behaviour has its own tests that switch it on (`test_local_install.py`,
  `test_request_guard.py`).
- **The tests use the dev database, Redis and Chroma** (m5 in PROGRESS.md).
  - Users are `test-<hex>@example.com`. After each test they are deleted, and
    storage folders with no matching user are removed.
  - **Never** point the suite at an install's database.
- **Rate-limit buckets are cleared before every test**: ASGITransport has no
  client IP, so all requests share the `unknown` bucket.
- **Transcription is not queued from uploads** (`dont_queue_transcription`).
  Otherwise a running worker would delete seeded captions mid-test. Pipeline
  tests call the task body directly.
- **Real media fixtures**: `sample_video_bytes` and `sample_silent_video_bytes`
  are built with FFmpeg (with and without audio), not random bytes.
- `@pytest.mark.network` marks tests that reach third-party hosts (Google
  Fonts). Deselect them with `-m "not network"`.

## 2. Commands

### Backend (dev stack)

```bash
cp .env.example .env                       # once; never commit .env
docker compose up -d                       # or add -f docker-compose.gpu.yml
docker compose exec backend alembic upgrade head
docker compose exec backend python -m pytest                  # whole suite
docker compose exec backend python -m pytest tests/test_request_guard.py -q
docker compose exec backend python -m pytest -m "not network" # offline
docker compose exec backend ruff check app tests              # optional, not enforced
```

**The dev stack and an install both use port 3000.** Run `vcm stop` first.

### Frontend

```bash
docker compose exec frontend npm run lint
docker compose exec frontend npm run type-check
```

**Never run `next build` inside the running dev container.** It overwrites
`.next` and every dev route returns 500. Build the image target instead,
which leaves the dev server untouched:

```bash
docker build --target build frontend
```

or on the host: `cd frontend && npm ci && npm run build` (what CI does, with
`NEXT_PUBLIC_API_URL=""`).

### End to end: `scripts/e2e.py`

Drives a running local-mode app through **upload → transcribe → translate →
export** for each language, and exits non-zero if any fails. It needs only
Python 3.9+, and **never deletes** anything.

```bash
# against an install (through the UI port, so the request guard is exercised)
python scripts/e2e.py --base http://localhost:3000 --video clip.mp4

# several clips, a subset of languages, no MP4 burn
python scripts/e2e.py --base http://localhost:3000 \
  --video en.mp4 --video hi.mp4 --languages same,en,hi,fr,de,nl --no-burn
```

| Option | Default |
|---|---|
| `--base` | `http://localhost:3000` |
| `--video` (repeatable, required) | |
| `--languages` | `same,en,hi,fr,de,nl` |
| `--no-burn` | burn MP4 too |
| `--timeout` (s per job) | 1800 |

For each job it prints the stages it saw, the time taken, any notice and the
first captions. Each job exports SRT, VTT and (unless `--no-burn`) MP4.

### Screenshots and accessibility (manual)

The procedure used for every v1.0.4 screen (PROGRESS.md, "v1.0.4 redesign
log"):
- screenshots at **375 px and 1440 px**, in **light and dark**;
- **axe-core** (WCAG 2 A/AA) must report **0 violations**;
- a keyboard pass: every stop shows the focus ring;
- no console errors and no horizontal overflow;
- run against the **production build**, not the dev server.

The scripts used were throwaway files and aren't in the repo.

### Update download size: `scripts/update_layers.py`

Proves that `vcm update` downloads only the image layers that changed.

```bash
# on the machine being updated, just before `vcm update`
docker image inspect $(docker image ls -q | sort -u) > images.json
python scripts/update_layers.py snapshot before.json < images.json

vcm update

# afterwards (anywhere with network access), per image
python scripts/update_layers.py report before.json video-caption-maker-backend 1.0.4-cuda
python scripts/update_layers.py report before.json video-caption-maker-frontend 1.0.4
```

A layer counts as reused when the daemon already held the same **chain ID**
up to it. Sizes are compressed, from the registry manifest (bytes on the
wire).

Baselines:

| Update | Backend | Frontend |
|---|---|---|
| 1.0.2 → 1.0.3 | CUDA 10/14 layers, 2245.7 MB; CPU 764.6 MB | 5/9, 6.2 MB |
| 1.0.3 → 1.0.4 | **0/14 layers** (CPU and CUDA) | **3/9, 6.1 MB** |

Full layer digests are in PROGRESS.md.

## 3. Critical flows and what covers them

| Flow | Automated (backend tests) | Manual / E2E |
|---|---|---|
| Upload validation: type, extension, empty, traversal filename, no paths in responses | `test_videos.py` | |
| Ownership: another user gets 404 on videos, exports, captions, search | `test_videos.py`, `test_exports.py`, `test_search.py`, `test_captions.py` | |
| Pagination and filters counted in SQL | `test_videos.py` (`test_pages_do_not_overlap_or_skip`, `test_total_counts_the_library_not_the_page`) | |
| Stream: token required, bound to one video, byte-identical, range requests, audio kept | `test_videos.py` | |
| Caption edit, split, merge, delete, sequence | `test_captions.py` | |
| Style fields, presets, ASS conversion, preview/burn contract | `test_caption_styles.py`, `test_exports.py` | |
| Sidecar formats (SRT/VTT/JSON), names, download tokens | `test_exports.py` | SRT opened in an external player (M8) |
| Burn-in: captions actually drawn into pixels, audio and resolution kept, scale before subtitles | `test_exports.py` (`test_captions_are_actually_drawn_into_the_pixels`) | MP4 per E2E job |
| Hardware tiers and model choice | `test_local_install.py` (`test_a_big_gpu_gets_large_v3_in_float16`, `test_cpu_with_little_ram_gets_small_int8`, …) | GPU, CPU and low-RAM runs (§4) |
| Local mode: no credentials, session without cookie, settings validation, key never returned | `test_local_install.py` | |
| Request guard and audit log | `test_request_guard.py` (8 tests; 6 fail with the guard removed) | live probes on both installs at `localhost` and `127.0.0.1` |
| Restart recovery and the 3-requeue limit | `test_recovery.py` (5 tests) | live OOM test: worker capped at 1 GB, 3 kills → failed (PROGRESS.md) |
| Transcription: segment splitting, silence filtering, no-speech retry, friendly errors | `test_transcription.py` (48) | |
| Search scoping and refusal | `test_search.py` | "not found" question (M9) |
| Font catalogue and downloads | `test_font_library.py` | |
| Translation, all 20 pairs (M2M100) | | GPU E2E 5 spoken × 6 targets = 30 jobs; CPU E2E 3 × 6 = 18 jobs; M2M100 service level 20/20 pairs; bad Gemini key falls back (R3) |
| Full UI flow through the guard | | Chromium in the install's network: delete, settings change, SRT and MP4 export at `localhost:<port>` and `127.0.0.1:<port>`, 0 refused (14/14 on v1.0.4) |

## 4. CPU and GPU tier testing

The tier is chosen in the worker from what it detects (DECISIONS.md D3), so
each tier is tested by changing what the worker can see:

| Tier | How it was run (PROGRESS.md) | Expected |
|---|---|---|
| **GPU** (≥ 6 GB VRAM) | dev stack with `-f docker-compose.gpu.yml`, or the installed CUDA variant | `large-v3` float16; Settings shows the GPU; MP4 uses `h264_nvenc` |
| **CPU, ≥ 12 GB RAM** | without the GPU override (the clean Linux machine) | `large-v3-turbo` int8, `m2m100_1.2B` |
| **CPU, < 12 GB RAM** | worker under an **8 GB cgroup memory limit** | `small` int8, `m2m100_418M`. Hindi carries the low-confidence notice (R4) |
| **OOM path** | worker capped at **1 GB** with `large-v3-turbo` forced | 3 requeues, then failed with the smaller-model message; after switching to automatic (small) and retrying, it completes |

- Settings → hardware should match what was set up.
  `GET /api/system` returns `hardware`, `whisper` (with `source`) and
  `translator_model`.
- Unit coverage of the tier logic is in `test_local_install.py`; it doesn't
  need a GPU.
- The verified GPU stack is pinned (PROGRESS.md, "Pinned GPU stack": RTX 5080,
  sm_120, CTranslate2 4.8.1, cuBLAS 12.9.2.10, cuDNN 9.24.0.43).

## 5. Clean-machine install testing

Used for M13/R6 and every release since (PROGRESS.md, learning-guide
"Testing an installer honestly"):

- **A clean Linux box** is a privileged `docker:dind` container with **zero
  images**. The README one-liner runs inside it unchanged.
- **Stand-ins for GitHub**, before a release exists:
  - a local `registry:2` for GHCR;
  - `python -m http.server` for release assets;
  - both reached through `VCM_REGISTRY` and `VCM_BASE_URL`, so the scripts
    never special-case tests.
- **The final test uses the real release**, with commands copied from the
  README on GitHub and no overrides.
- **Name the test resources** (e.g. `vcm-clean`, `vcm-test-registry`) and
  delete **only those** afterwards. **Never** run `docker system prune` or any
  host-wide prune on a machine that also runs the dev stack.
- The dev stack is compose project `videocaptionmaker` and the install is
  `vcm`, so an install's `--remove-orphans` can't touch dev.
- **Keep-data uninstall** may be tested on the dev machine. **The `DELETE`
  path only on the clean machine.** Afterwards, check:
  - 0 containers, 0 `vcm_*` volumes (and redis's anonymous volume), no
    `vcm_default` network, no app images, no install folder, no `vcm` link;
  - the base images (postgres, redis, chroma) still present;
  - the dev stack's containers, volumes and database checksum unchanged.
- **Update safety (R5):**
  1. roll the database back one migration;
  2. run `vcm update`;
  3. confirm the upgrade ran on start, and that row counts (videos,
     captions, exports) and an **md5 of all caption text** are unchanged.
  
  A real update only upgrades; see DATABASE.md §6.

Waiting on nested Docker pulls can be slow (0.3–0.6 MB/s measured in dind),
so give time estimates for long steps.

## 6. Release checklist

The sequence used for v1.0.0–v1.0.4. The maintainer pushes and tags; nobody
else does.

**Before tagging**
1. All work committed in small commits; PROGRESS.md updated.
2. Backend suite passes in the dev stack.
3. `npm run lint`, `type-check` and `build` pass.
4. UI changes have screenshots at 375/1440 px in light and dark, and axe
   reports 0.
5. E2E on the GPU install, and on CPU for pipeline changes.
6. CI green on the `main` commit to be tagged.

**Tag and release** (maintainer)
1. Push `main`, then the tag `vX.Y.Z`.
2. `release.yml` must finish all 4 jobs green:
   - images: backend cpu, backend cuda, frontend;
   - release.
3. GHCR gets `X.Y.Z-cpu`, `X.Y.Z-cuda`, `latest-*` and the frontend
   `X.Y.Z`/`latest`.
4. The Release has **8 assets**. Download them from
   `releases/latest/download/` and check each against `SHA256SUMS`.
5. Packages and repo are public (an anonymous manifest fetch returns 200).

**After release**
1. Snapshot layers with `update_layers.py` on each install.
2. `vcm update` both installs (Windows GPU, Linux CPU).
3. Report the downloaded layers and bytes against the previous baseline.
4. Check, on both installs:
   - `VCM_VERSION` is the new version;
   - alembic is at head;
   - the video list is unchanged.
5. Guard probes: another origin, cross-site and a rebinding Host each give
   403; the app's own origin passes.
6. Run the UI flow through the guard at `localhost` and `127.0.0.1`.
7. Run E2E if the pipeline changed.
8. Secrets check:
   - no `.env`, key, cert, dump or storage file in git history;
   - none in the images (only distro CA bundles, an empty extra-CA dir);
   - release assets are only the 7 files plus `SHA256SUMS`.
9. Remove named test resources only.
10. Update PROGRESS.md and the CHANGELOG.

## Open questions

1. **The screenshot and axe harness isn't in the repo.** Should it be
   committed (for example under `scripts/ui-check/`) so the v1.0.4 procedure
   can be repeated?
2. **The backend suite doesn't run in CI.** It needs Postgres, Redis, Chroma
   and FFmpeg; GitHub Actions could provide them as service containers. Is
   that wanted?
3. **Tests share the dev database.** They create and delete `test-%` users
   there. Should they get an isolated database (m5 chose to document rather
   than isolate)?
4. **The low-RAM test procedure isn't recorded.** PROGRESS.md records "worker
   capped at 8 GB (cgroup)" but not the exact command or compose change.
   Should a reproducible recipe be added?
5. **macOS has never been tested.** Is there a plan, or a person, to run the
   installer on a Mac?
