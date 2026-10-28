# Decisions

One entry per key decision. The context, alternatives and reasons come from
PROGRESS.md ("Decisions (Step 0)" and the Done log), the code comments, and
the commits named in each entry. Dates are when the decision landed in git.

---

## D1. Docker-based install

**Date:** 2026-10-07 (`f594b6d`, `e589f67`, `4384ff2`, `de8a875`)

**Context.** The app is six services:
- Python with CUDA-sensitive ML libraries (CTranslate2, faster-whisper,
  torch);
- FFmpeg with fonts;
- Postgres, Redis and ChromaDB;
- a Next.js server.

The target users have Windows, Linux or macOS machines, and no
Python/Node/CUDA toolchain to rely on.

**Decision.** Ship prebuilt images and a compose file. The one-line
installers (`install.sh`, `install.ps1`) check Docker, the GPU and the disk,
generate `.env`, pull and start the stack, and add a `vcm` command.

**Alternatives.**
- Native installers per OS: **not formally considered** (maintainer,
  2026-10-14). Docker was chosen to have **one install path across Windows
  and Linux, GPU and CPU**. The pinned GPU stack (CTranslate2 4.8.1 +
  cuBLAS 12.9 + cuDNN 9.24 for Blackwell) is also exactly what would be hard
  to reproduce natively on every machine.
- A hosted service: contradicts the product goal (local, no account, the
  video never leaves the machine).

**Reason.** One environment that is identical everywhere. The GPU passes
through Docker Desktop (WSL 2) or the NVIDIA Container Toolkit. Updates are
an image pull.

**Trade-offs.**
- The user needs Docker, a large prerequisite on Windows/macOS.
- The images are 0.8 GB (CPU) and 2.3 GB (CUDA) compressed.
- Apple Silicon runs amd64 images under emulation.
- Port conflicts with other local apps are handled by the installer's
  port fallback.
- TLS-intercepting antivirus needs the `certs/` workaround.

---

## D2. Local mode without login

**Date:** 2026-10-07 (`8ca8596`, `bc4f74a`)

**Context.** The app was built with full accounts: registration, JWT, Google
OAuth and password change. Installed on one person's computer, that meant a
sign-up screen for a single-user app (PROGRESS.md M4).

**Decision.** `AUTH_MODE=local` is the default:
- one user is created automatically (`get_or_create_local_user`);
- every request acts as them;
- `/auth/refresh` hands out a session without a cookie;
- the frontend build with `NEXT_PUBLIC_AUTH_MODE=local` redirects `/`,
  `/login` and `/register` to `/dashboard` and hides the account UI.

The accounts code is **kept intact**: `AUTH_MODE=accounts` restores it, and
the test suite runs in that mode.

**Alternatives.**
- A local password: rejected; it adds friction and gives no real protection
  for a single user.
- Deleting the auth code: rejected; the hosted mode would be lost.

**Reason.** The person at the computer is the only user. The network
boundary (127.0.0.1) replaces authentication.

**Trade-offs.**
- Any page in the user's browser can reach localhost, which required D6.
- Two auth paths must stay working, so accounts mode keeps its tests.
- Install-wide settings are refused in accounts mode (403), so one account
  can't change them for everyone.

---

## D3. Pick models from the hardware, let an explicit choice win

**Date:** 2026-10-07 (`aa8e80e`)

**Context.** Whisper was hardcoded to `cuda`/`float16`/`large-v3`, which
broke on any machine without an NVIDIA GPU (PROGRESS.md M1).

**Decision.** The worker detects the hardware and picks a tier:
- GPU with ≥ 6 GB VRAM: `large-v3` float16;
- CPU with ≥ 12 GB RAM: `large-v3-turbo` int8;
- otherwise: `small` int8;
- the translator is 1.2B at ≥ 12 GB RAM, 418M below.

Precedence: Settings, then `WHISPER_MODEL_SIZE`, then the tier. RAM is the
cgroup limit when lower than the host's. The worker reports its hardware to
the API through `app_settings`. A GPU that fails to load falls back to the
CPU with a notice.

**Alternatives.**
- A single model for everyone: `large-v3` doesn't fit 8 GB laptops, and
  `small` wastes a GPU.
- `medium` for GPUs: measured worse than large-v3 on Hindi with music. It
  missed 46 s and injected Spanish and Russian words (`config.py`).
  Offered in Settings as a manual choice until v1.1.0, then removed: at
  1.53 GB it is as big as large-v3-turbo (1.62 GB), slower, and measured
  worse, so no machine is better served by it. A stored `medium` choice
  reads as `auto`; `WHISPER_MODEL_SIZE=medium` still works for anyone who
  sets it by hand.

**Reason.** One image has to work on a 16 GB-VRAM desktop and an 8 GB laptop.

**Trade-offs.**
- The `small` tier is weak on fast non-English speech (Hindi). This is a
  documented limitation, mitigated by a retry and a notice.
- The tier can be surprising, so Settings shows the model and its `source`.

---

## D4. M2M100 for local translation, not NLLB; Gemini optional

**Date:** 2026-10-07 (`dc77d43`, `7ac5f51`)

**Context.** Translation needed Gemini, so no key, no network or no quota
meant no translation (PROGRESS.md M2). A local model was needed for
hi/fr/de/nl, which have to work offline.

**Decision.**
- **Default:** M2M100 via CTranslate2 int8, run locally.
  - The weights are `jncraton/m2m100_{1.2B,418M}-ct2-int8`, **pinned to a
    commit**.
  - 1.2B with ≥ 12 GB RAM, 418M below.
- **With a Gemini key** (Settings): Gemini first (25 lines per batch, 3
  attempts). Any failure falls back to M2M100 with a notice.
- **A translation failure never fails the job.**
- **Whisper and the translator are never in memory together.**
- English targets use Whisper's own `translate` task.

**Alternatives.**
- **NLLB-200:** the best quality, but **CC-BY-NC-4.0**, non-commercial only.
  Rejected.
- **Opus-MT:** one model per language pair, and weak Hindi. Rejected.
- **Gemini only:** not offline, and needs a key. Rejected as the default.

**Reason.** M2M100 is MIT-licensed, and one model covers all 20 pairs among
the five languages. Verified 20/20 pairs and 30 GPU plus 18 CPU E2E jobs.

**Trade-offs.**
- M2M100 translates line by line, so idioms and fragments come out literal.
- A 0.5–1.3 GB download on first use.
- Third-party conversions (mitigated by the commit pin and a weights-only
  format).

---

## D5. Semantic search is retrieval-only by default

**Date:** 2026-10-07 (`fd4e793`, `9ab2721`)

**Context.** Search answers (RAG) needed Gemini (PROGRESS.md M3).

**Decision.**
- `GET /api/search` returns timestamped caption passages (MiniLM embeddings
  in ChromaDB, cosine distance ≤ 0.75), and a click jumps to the moment.
  This always works locally.
- `POST /api/ask` writes an answer **only when a Gemini key is set**. Without
  one it returns the passages and a sentence saying a key enables answers.
- With a key:
  - no hits → refusal, without calling the model;
  - the model is told to refuse when the context doesn't answer;
  - citations are attached from the server's own hits, never from the
    model's text.

**Alternatives.**
- **A local LLM for answers (Ollama + Qwen2.5-3B):** considered and
  rejected (maintainer, 2026-10-14). It meant an extra container, a ~2 GB
  model download, and slow answers on CPU, which is the tier most installs
  run on.
- **Requiring a key for search:** rejected; retrieval is the useful part and
  needs no LLM.

**Reason.**
- Retrieval needs no network.
- The milestone plan's acceptance test for answers is "not found, not a
  fabrication", which retrieval-only satisfies trivially, and the two-layer
  refusal satisfies with a key.

**Trade-offs.**
- No written answers offline.
- No term highlighting, since semantic hits have no matched words.
- The encoder loads in the API process on first search.

---

## D6. The request guard

**Date:** 2026-10-12 (`491ebee`, refined in `72ea1fa`)

**Context.**
- On 2026-10-11, six videos on an install were deleted through the frontend
  proxy by an unknown actor. The logs had no User-Agent or Origin, and the
  container was replaced on update (PROGRESS.md R11).
- Local mode has no login (D2), and 127.0.0.1 is reachable from any page in
  the user's browser:
  - by DNS rebinding;
  - by cross-site or same-site requests from another localhost app.

**Decision.** In local mode, middleware (`backend/app/request_guard.py`):
1. refuses any request whose host (forwarded or direct) is not `localhost`,
   `127.0.0.1`, `::1` or `backend`, reads included;
2. refuses state changes with `Sec-Fetch-Site: cross-site`;
3. through the proxy, requires `Origin` to **equal the forwarded host:port**
   exactly;
4. lets requests with no `Origin` (scripts) through.

Refusals, DELETEs and settings changes are appended to
`storage/audit.log`, without bodies, rotated at 5 MB.

**Alternatives.**
- **CORS alone:** insufficient.
  - It controls reading responses, not sending requests.
  - Rebinding makes the attacker same-origin.
  - Behind the proxy, every request reaches the API from the frontend.
- **A trusted `CORS_ORIGINS` value:** the first version of the guard trusted
  it. The production compose never set it, so `http://localhost:3000` was
  trusted on every install, including one moved to 3001. That was replaced by
  the forwarded-host rule (`72ea1fa`).
- **A login or CSRF token:** contradicts D2.

**Reason.** It closes rebinding and cross-origin writes without a login, and
it makes any future incident traceable.

**Trade-offs.**
- Local programs can still call the API (by design).
- The rule depends on the Next proxy setting `X-Forwarded-Host`, and on
  uvicorn trusting forwarded headers. That is safe only because the backend
  isn't published.

---

## D7. Version metadata last in the Dockerfiles; registry build cache

**Date:** 2026-10-12 (`949fe9d`)

**Context.** Every release re-downloaded the whole backend image (765 MB CPU,
2,246 MB CUDA from 1.0.1 to 1.0.2), although no dependency had changed. Two
local builds that differed only in `VERSION` changed layers 4–13.

Two causes:
- `ARG VERSION` at the top of the runtime stage is visible to every `RUN`
  after it, so a new version invalidated them all;
- the GitHub Actions cache (10 GB, 7-day eviction) missed, so pip rebuilt the
  venv with new timestamps, and the 570 MB+ layer got a new digest.

**Decision.**
- Move `ARG VERSION`/`LABEL`/`ENV VCM_VERSION` to the **end** of both
  Dockerfiles' runtime stages.
- Switch CI to a **GHCR registry cache** (`buildcache*` tags,
  `mode=max`).
- Order layers from least to most frequently changed:
  1. base;
  2. apt;
  3. venv;
  4. caption fonts;
  5. fc-cache;
  6. alembic and app code;
  7. entrypoint;
  8. version.

**Alternatives.** Keep the Actions cache (it evicts); accept full downloads
(2.3 GB per update on CUDA).

**Reason.** Updates should download only what changed. Measured 1.0.3 →
1.0.4: **0 of 14 backend layers** and 3 of 9 frontend layers, 6.1 MB, in
20–23 s. The release build fell from 10 min to 2 min.

**Trade-offs.**
- The 1.0.2 → 1.0.3 update was a full download, once.
- Cache tags in GHCR take space.
- `frontend/public/fonts` is copied into the backend image, so changing a
  caption font invalidates backend layers 7 and up (about 1.3 MB).

---

## D8. GHCR images and GitHub Releases for distribution

**Date:** 2026-10-07 (`90cc5d4`), first release v1.0.0 on 2026-10-08

**Context.** The installers need a stable URL for the scripts and a registry
for the images (PROGRESS.md, decision d).

**Decision.**
- Pushing a `v*` tag runs `.github/workflows/release.yml`, which:
  - builds backend `cpu` and `cuda` and the frontend, and pushes them to
    `ghcr.io/tanush1206/video-caption-maker-*` as `X.Y.Z[-variant]` and
    `latest[-variant]`;
  - attaches the scripts, the compose files and `SHA256SUMS` to a GitHub
    Release.
- The installers fetch from `releases/latest/download/`.
- The CUDA job frees about 30 GB of runner disk first.
- The repo and packages are public.

**Alternatives.**
- **Docker Hub:** considered and rejected (maintainer, 2026-10-14). Its
  anonymous pull rate limits are a real risk for a 2+ GB image pulled by
  people with no Docker account, on install and on every update. GHCR serves
  public images anonymously, from the same place as the code.
- Self-hosting the scripts: not considered; `releases/latest/download/` gives
  a stable URL for free.

**Reason.** Free for public projects, in the same place as the code, and the
tag drives both images and assets. `releases/latest/download/` gives the
README a URL that never changes.

**Trade-offs.**
- GHCR packages start private and must be made public by hand after their
  first push.
- Images are pulled by tag, not digest, and aren't signed. `SHA256SUMS`
  covers the scripts but not the images (SECURITY.md §8).

---

## D9. Requeue stranded jobs on worker start, at most 3 times

**Date:** 2026-10-11 (`8e137c0`, `8c4a461`, `98202fe`, `02a4576`)

**Context.**
- Redis runs without persistence. After a Docker restart, a job in flight
  stayed "processing" forever, and the API refused a retry (PROGRESS.md).
- The first fix requeued stranded jobs at startup. But a job that **crashes
  the worker** (OOM) would then be requeued, crash it again, and loop
  forever.
- Separately, a job killed mid-run stayed in Redis's `unacked` set and was
  redelivered after an hour, outside any counter.

**Decision.**
- `recovery_attempts` on `videos` and `exports` (migration `b4e7c2d91a36`).
- At `worker_ready`:
  1. take over unacked video and export jobs;
  2. requeue each stranded job while `recovery_attempts < 3`, **committing
     the count before queuing**;
  3. after 3, fail it with "…usually means the computer ran out of memory.
     Choose a smaller speech model…".
- A manual retry resets the count.

**Alternatives.**
- Persist Redis: it doesn't solve a job that crashes the worker.
- Requeue without a limit: an infinite crash loop.
- Rely on Celery's visibility-timeout redelivery: hourly, and uncounted.

**Reason.** It recovers from ordinary restarts automatically, and it fails
honestly with an actionable message when the job itself is the problem. With
`--pool=solo`, an OOM kill takes the container down, and Docker's restart
runs recovery. Verified live: 3 OOM kills, then failed; a retry on the small
model completed.

**Trade-offs.**
- It assumes **one worker node**: anything "processing" at startup is
  treated as stranded.
- 3 is a fixed constant (`MAX_REQUEUES`).
- A rerun costs time; both pipelines are idempotent.

---

## D10. Polling, not SSE or websockets, for progress

**Date:** Milestone 4 (2026-08); kept through v1.0.4

**Context.** Progress for transcription and renders has to reach the UI.

**Decision.** The worker writes `stage`, `progress` and `stage_detail` to the
row in its own short session. The UI polls with TanStack Query
`refetchInterval`, **only while something is busy**:
- videos every 2 s;
- exports every 1.5 s;
- alerts every 3 s.

**Alternatives.** SSE or websockets (the milestone plan's original "TBD", docs/MILESTONES.md).

**Reason.** Progress changes a few times a minute, and a short poll avoids
connection, reconnection and auth handling (comment in
`frontend/src/hooks/use-videos.ts`). The ETA is computed in the browser from
the observed rate.

**Trade-offs.** Up to 2 s of latency, and a little idle traffic while jobs
run. Re-confirmed on 2026-10-14 (maintainer): the 2 s poll is fine as is,
including for model-download progress.

---

## D11. One worker, one job at a time

**Date:** Milestone 4 (2026-08); kept through v1.0.4

**Context.** Whisper holds gigabytes of RAM or VRAM.

**Decision.** Celery runs with `--pool=solo`, `worker_prefetch_multiplier=1`
and `task_acks_late=True`. One worker container.

**Alternatives.** A prefork pool, or several workers: each would load its own
model copy.

**Reason.** Two model copies would exhaust an ordinary machine's memory, and
transcription is GPU- or CPU-bound anyway.

**Trade-offs.**
- Jobs queue behind each other: a long render delays the next
  transcription.
- Recovery (D9) depends on there being exactly one worker.

---

## D12. No Celery time limits; each step bounds itself

**Date:** v1.0.5 (2026-10-14)

**Context.** `celery_app.py` set a 30 min soft and 35 min hard limit, which
would kill a long CPU transcription (roughly real time, longer on the small
tier) or a render allowed 3 h. Measured: under `--pool=solo` (D11), Celery
enforces neither limit. A 6 s task under a 3 s hard limit ran to completion.

**Decision.** Set both to `None`, and say why in the code. A job is bounded
by the steps that can hang: FFmpeg renders (3 h), probes (30 s), thumbnails
(60 s), waveforms (300 s). `tests/test_worker_config.py` pins it.

**Alternatives.**
- Raise the limits: misleading for the same reason.
- Derive a limit from the video's duration: needs a pool that enforces it,
  which solo doesn't, and a prefork pool contradicts D11.

**Trade-offs.** A step without its own timeout (Whisper decoding) can run as
long as it runs. A hung decode blocks the single worker until it is
restarted, which then requeues it under D9's limit.

---

## D13. Forwarded headers trusted by service name

**Date:** v1.0.5 (2026-10-14)

**Context.** uvicorn ran with `--forwarded-allow-ips='*'`, so any caller could
set the client address that `audit.log` records. uvicorn trusts only IPs or
networks, and the frontend's IP is unknown when the API starts: it starts
after it, and changes when recreated.

**Decision.** Run uvicorn with `--no-proxy-headers`, and add the
`TrustedProxyHeaders` middleware (`app/proxy_headers.py`). It trusts the
addresses the name `frontend` resolves to (`TRUSTED_PROXIES`), re-resolved at
most every 5 s.

**Alternatives.**
- A fixed IP for the frontend on a fixed subnet: would change the `vcm_default`
  network of existing installs on update, and could collide with networks
  already on the user's machine.
- Trusting the whole compose subnet: the Docker gateway (host connections in
  dev) is inside it.

**Trade-offs.** One DNS lookup at most every 5 s on the request path. Trust
follows the name, so anything else given the alias `frontend` on the network
would be trusted. Only the compose file assigns it.

---

## D14. A caption language is admitted on evidence, offline only

**Date:** v1.0.7 (2026-10-16)

**Context.** Twelve languages were asked for. M2M100 lists a hundred, but
"in the model's list" is not "usable": on two short texts, Kannada returned
a remembered news story in place of three captions, Gujarati printed web
crawl furniture ("Read also:"), and Punjabi inverted a sentence's meaning.

**Decision.** A language is offered only if (1) M2M100 lists it, so the core
flow works offline; (2) a translation sweep is usable (right script, mostly
right meaning); (3) it burns correctly in a bundled or installed font with
complex shaping; (4) it passes E2E. Usable but weak is offered and listed as
a limitation. TESTING.md "Adding a caption language" is the procedure; a test
holds `LANGUAGES` to `M2M100_LANGUAGES`.

**Alternatives.**
- Offer every M2M100 language: rejected; users would get invented captions
  with no warning.
- Gemini-only languages: rejected; the app must work without a key or a
  network.

**Trade-offs.** Telugu, Kannada, Gujarati and Punjabi are left out until a
better local model exists, which is a model change and the maintainer's call.

---

## D15. The preview reproduces libass's metrics, not the other way round

**Date:** v1.0.7 (2026-10-16)

**Context.** Measured on burned frames, the preview drew captions up to
1.76x larger than the export (libass sizes a face by its win cell, CSS by its
em), wrapped lines greedily where libass balances them, and drew Indic text
in whatever font the viewer's OS had.

**Decision.** The burn is the product, so the preview follows it:
- the style serves the face's win span; the preview divides the font size by
  it and uses it as the line height;
- `text-wrap: balance`, as libass's WrapStyle 0;
- Devanagari, Bengali, Tamil and Malayalam in vendored Noto faces in both
  renderers, named per run in the ASS with `\fs` scaled to the caption
  font's em, and first in the CSS stack with `unicode-range`.

**Alternatives.**
- Change the burn to CSS semantics (scale `Fontsize` by the span): would
  change every existing export's size, and still leave wrapping and fallback
  fonts to two different engines.
- Render the preview with libass (WebAssembly): one renderer, but a large
  dependency and a rewrite of the overlay, its drag and its handle.

**Trade-offs.** A caption is now drawn smaller in the editor than before
v1.0.7 — at the size it always had in the MP4. `text-wrap: balance` and
libass's smart wrap are close, not identical (measured 60/63% against
61/64% of the frame). *Superseded for wrapping and placement by D16.*

---

## D16. One layout rule for the caption box, computed by us, not by either renderer

**Date:** v1.0.7 (2026-10-17)

**Context.** Placement still failed after D15: a caption was positioned by
an anchor plus margins, or by `\pos` with libass wrapping at the margins
and the browser at whatever space was left. Dragged to an edge it wrapped to
one word per line (1.0.6) or hung out of the frame with its padding, outline
or shadow cut off (1.0.7 before this), and a box with padding 0 overflowed
the bottom. Two renderers each wrapping and placing by their own rules
cannot be made to agree by tuning one of them.

**Decision.** The model is the one VEED, AutoCaptions and broadcast
captions use: a box with its own width (`box_width`, default 80% landscape /
85% portrait), a line limit with a font shrink (`max_lines`, down to 70%, then
one extra line), placed by its centre (`pos_x`/`pos_y`), and slid inside a 3%
safe area by its whole painted rectangle, per caption. One function computes
the lines, size and position — `services/caption_layout.py`, measuring with
HarfBuzz on the files libass draws with — and the burn hands libass its
output (`\N` breaks, `\fs`, `\an5\pos`, WrapStyle 2, zero margins). The
editor runs a line-for-line copy (`lib/caption-layout.ts`, canvas
`measureText`) and draws the lines itself, `white-space: pre`. A migration
converts every saved anchor and placement to the equivalent centre.

**Alternatives.**
- Keep libass wrapping and teach the preview its rules: libass's wrap is
  not specified, and D15 showed the browser can only approximate it.
- Ask the server for every layout: exact, but a round trip per frame of a
  width drag; the copy is checked against the server instead
  (`layout-parity`).
- Clamp in the browser only: the burn would still place by its own rules.

**Trade-offs.** The layout exists twice and must be changed in both places;
`layout-parity` and `test_caption_layout.py` catch a drift. Existing
captions get the default width, so a caption that filled ~94% of a
landscape frame before may now take one more line. The baseline inside a
line can differ by a pixel or two between the renderers.

## D17. Hindi in Roman script on its own model, asked for before processing

**Date:** v1.0.9 (2026-10-21)

**Context.** Hindi/Hinglish captions were the weakest result in the app:
on a 228 s Hinglish tutorial large-v3 scored 74% WER after romanising, got
12 of 73 English words right (it writes "कैप्शन्स" for "captions") and
skipped stretches of speech. Most people who speak Hinglish also type it in
Latin letters.

**Decision.**
- Hindi can be written in Roman script ("Hinglish") by Oriserve's Apex, a
  large-v3-turbo fine-tune (Apache-2.0): 31% WER, 65 of 73 English words,
  7.6 s on the GPU and 35.5 s on the CPU for the clip, every caption start
  within the timing rule. Prime (the large-v3 fine-tune) was measured and
  not used: no more accurate, 3× slower, twice the memory and download, and
  its word timings run early.
- Hinglish is the default for Hindi heard at 70% or more. The language step
  asks "Hindi captions in: Hinglish (Roman) / हिन्दी (Devanagari)" before
  anything is transcribed, so the upload starts when a file is picked and
  the language is detected meanwhile. Below 70%, or for Marathi, nothing is
  preset and Start waits; after 15 s without an answer the step asks
  without holding Start.
- Translations of Hinglish go through IndicXlit's Devanagari: M2M100 can't
  read Roman Hinglish. English captions stay Whisper's own translation.
- Both models download on first use from their original repos, pinned to a
  commit and checked against their sha256, and are converted on the
  machine; nothing is baked into an image.
- Existing videos, and clients that don't send a script, stay Devanagari.

**Alternatives.**
- IndicXlit on large-v3's Devanagari (the original plan): it can only
  re-spell what large-v3 heard, and large-v3 is what was wrong.
- Roman Hinglish straight into M2M100: it copies English and Spanish
  through and invents Marathi.
- Hosting converted models ourselves: another thing to publish, version and
  trust; converting on the machine keeps the source the original repo.
- Asking about the script on the video page after detection, or always
  showing it: the first asks too late, the second asks about Hindi for
  every video.

**Trade-offs.** The upload now starts before Start, so Back and closing the
page have to delete it (and an hour's sweep catches what they can't). Two
more downloads (1.6 GB and 138 MB) on first use. IndicXlit transliterates
word by word, and translations of Hinglish carry its mistakes ("To" → टो).
Gemini gets the Devanagari too until it is measured on Roman.

---

## D18. Four Indian languages removed rather than marked Beta

**Context.** The v1.0.10 language report (FLEURS, [LANGUAGE_QUALITY.md](LANGUAGE_QUALITY.md))
measured Tamil, Marathi, Bengali and Malayalam as the weakest by far:
63-122% word error on large-v3 (Malayalam in the wrong script) and chrF
24-43 into them, against 3-7% and 55-68 for the European languages.

**Decision (Tanush, 2026-10-23).**
- Removed in v1.0.11, not marked Beta: from every picker and from the
  API's validation, as captions and as speech.
- Speech heard in a language not offered (any, not only these) isn't made
  into captions silently: the language step says so and waits for a spoken
  language to be chosen or "Try anyway", neither preset. "Try anyway" with
  "Same as spoken" gives captions in what was heard, and the video's page
  says they are likely inaccurate.
- Videos made in them keep their captions and export; nothing is deleted.
  Their fonts stay (those captions, and "Try anyway", use them).
- Back on the [ROADMAP](ROADMAP.md) with Indian-language fine-tuned speech
  models, judged by the same eval.

**Alternatives.** A "Beta" label: the captions would still be wrong most
of the time, and the label easy to miss. Refusing unsupported speech
outright: no way left to try a language Whisper half-knows.

---

## D19. A caption's position is its block's anchor by alignment

**Context.** From v1.0.7 (D16) `pos_x` was the centre of a box Max width
wide, and Left/Right lines sat against that box's edges. Whenever Max width
was wider than the text, changing alignment threw the caption across the
frame: at 80% a caption dragged to the right edge jumped to the middle on
Left (measured: up to 1091 px at 80% and 1350 px at 94% on 1080p).

**Decision (Tanush, 2026-10-28).**
- The visible block is only as wide as its longest line; Max width only
  limits how wide a line may get.
- `pos_x` is that block's anchor for the alignment: its left edge on Left,
  centre on Centre, right edge on Right. Left captions of different lengths
  share one left edge, Right ones one right edge.
- Changing alignment never moves the caption on screen: the editor saves the
  anchor that keeps its block exactly where it is (`anchorOf`). Alignment
  otherwise only sets the lines against each other inside the block.
- Dragging moves the anchor; the clamp keeps every block inside the safe
  area, per caption, as before.
- Saved Left/Right styles get the old box's left or right edge
  (`e8b3d5f19a42`), which reproduces the old layout exactly; Centre styles
  are unchanged. Editor and burn share the one layout rule.

**Alternatives.** Centre every block on `pos_x` whatever the alignment:
simpler, but Left captions of different lengths would no longer line up,
and no position could keep old Left/Right videos' look. Migrating by a
median or longest caption: every other caption would still move.

---

## D20. Uploads bypass Next's rewrite proxy

**Context.** The Next 15.5 upgrade broke every upload over 10 MB. Next's
`/api` rewrite proxy, and any request middleware runs on, copies the request
body and keeps the copy: Next 15 caps the copy at 10 MB and cuts the upload
there; Next 14, shipped until 1.1.1, kept all of it, so every upload sat in
the frontend's memory (34 → 241 MiB for one 192 MB upload). Node's server also
ended any request still arriving after five minutes, so a slow upload failed
in 1.1.1 too, and a cancelled upload's temporary file stayed open in the API.

**Decision (Tanush, 2026-10-28/29).**
- `/api/videos`, the one route with a large body, is forwarded by a route
  handler that streams it with Node's `http` (no `fetch` timeouts; only a
  connection quiet for 30 minutes is given up on). Every other `/api` path
  keeps the rewrite.
- The middleware skips exactly that path; every other path keeps its guard.
  There the API's guard refuses other origins, other localhost ports and
  rebinding Hosts.
- The preload overwrites `X-Forwarded-Host` with the request's own Host, as
  it does `-For` and `-Proto`, so the API's Host check can't be forged.
- Node's `requestTimeout` is off on the frontend's server.
- Cancelling ends the API's request, and the API frees the partial upload at
  once (`app/multipart.py`).

**Alternatives.** Raising Next's body limit: Next would then hold up to the
4 GB upload limit in memory. Excluding only the middleware: the rewrite proxy
copies the body too. A hand-written proxy in the preload: works, but sits
outside Next. Staying on Next 14: the memory and timeout problems remain.

---

## Decisions recorded

Answers from the maintainer (2026-10-14) to this document's former open
questions, now in the entries above:

| Question | Answer |
|---|---|
| D1: native installers? | Not formally considered; Docker chosen for one install path across Windows/Linux and GPU/CPU. |
| D5: local LLM for answers? | Ollama + Qwen2.5-3B considered and rejected (extra container, ~2 GB download, slow on CPU). |
| D8: Docker Hub? | Considered and rejected (anonymous pull rate limits for a 2+ GB image). |
| D10: 2 s poll? | Fine as is. |
