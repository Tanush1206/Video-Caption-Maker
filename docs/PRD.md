# Product requirements: VideoCaptionMaker

Status: describes the product as of **v1.0.6**, the latest release
(2026-10-15). Everything here is taken from the code,
the config, the tests and [PROGRESS.md](../PROGRESS.md). Product questions are
answered by the maintainer and recorded in [Decisions recorded](#decisions-recorded).

## 1. Product overview

VideoCaptionMaker makes captions for a video **on the user's own computer**.
The user uploads a video and picks a caption language. The app then
transcribes the speech locally (Whisper, via faster-whisper), translates it
locally if needed (M2M100, via CTranslate2), and exports the result as a video
with the captions burned in (MP4) or as subtitle files (SRT, VTT, JSON).

It installs with one command (Docker Compose under the hood), runs as a
single-user app with **no login**, and serves its UI only on `127.0.0.1`.
Gemini is optional. With a key pasted into Settings it translates captions and
writes answers to search questions. Without one, everything runs offline once
the models are downloaded.

## 2. Problem

From the README and the decisions in PROGRESS.md:

- Captioning tools usually send the video to a cloud service, need an account
  and charge per minute. Here the video never leaves the machine and there is
  no account.
- The person installing it may have a gaming PC with an NVIDIA GPU, or a
  laptop with 8 GB of RAM and no GPU. The app has to pick models that fit the
  machine it finds (`backend/app/services/hardware.py`).
- Installing a multi-service ML stack by hand is not realistic for an end
  user. Everything has to come from one command, with no `.env` to edit.

## 3. Target users

**Individual creators, students and small teams** who want private, offline
captions and translation on their own computer, **especially Hindi ↔ English**.
In practice that means:

- **A single person on their own computer**: Windows 10/11 with WSL 2, Linux,
  or (untested) macOS, with Docker installed. Local mode has exactly one user
  (`get_or_create_local_user`, `backend/app/services/auth.py`).
- **People who need captions in English, Hindi, Bengali, Marathi, Tamil, Malayalam, French, German, Dutch, Spanish, Portuguese, Italian or Russian**: the thirteen caption languages in
  `backend/app/services/languages.py` (v1.0.7; five before).
- **Non-developers**: the README's install, use and troubleshooting sections
  assume no programming knowledge, and error messages are written as sentences
  (`friendly_error` in `backend/app/workers/transcription.py`).

A hosted multi-user mode (`AUTH_MODE=accounts`) still exists in the code. It
is not an active direction: it is kept, tested, and documented as an optional
future hosted mode ([ROADMAP.md](ROADMAP.md)), and is not shipped.

## 4. User stories

| # | As a user, I want to… | So that… | Implemented by |
|---|---|---|---|
| US1 | install the app with one command | I don't have to set up Python, models or databases | `install/install.sh`, `install/install.ps1` |
| US2 | drop a video and choose the caption language before it uploads | the one transcription produces the captions I asked for | `video-upload.tsx`, `language-step.tsx`, `POST /api/videos` (`caption_language`) |
| US3 | see what the app is doing while it works (download, extract, transcribe, translate, index) | a long job doesn't look like a hang | `videos.stage`, `stage_detail`, `progress`; `lib/stages.ts` |
| US4 | download the video with captions burned in, or SRT/VTT | I can publish it or load the subtitles in a player | `POST /api/videos/{id}/exports`, Export dialog |
| US5 | fix a wrong word, retime a caption on the waveform, split or merge lines | the captions match what was said | `PATCH /api/captions/{id}`, `/split`, `/merge-next`, timeline |
| US6 | style the captions (font, size, colours, outline, box, position) and see the result before exporting | the burn-in looks the way the preview showed | `caption_styles` table, style studio, ASS renderer |
| US7 | find the moment in my videos where something was said, by meaning | I don't need the exact words | `GET /api/search` |
| US8 | change the speech model, or paste a Gemini key, in Settings | I don't have to edit config files | `PATCH /api/system/settings` |
| US9 | update to a new version without losing my videos | updates are safe | `vcm update` (migrations run on start) |
| US10 | uninstall, choosing whether my videos are deleted | nothing is deleted by surprise | `vcm uninstall` (asks for `DELETE`) |
| US11 | retry a failed video with the smallest speech model in one click | a video that ran out of memory can still be captioned | "Retry with small model" on the failed screen |
| US12 | have the app follow my system's light or dark theme | it matches the rest of my desktop | Settings → Interface theme → System |

## 5. Core flow

```
Install ──► Upload ──► Language ──► (processing) ──► Edit (optional) ──► Export
```

1. **Install.** `curl … install.sh | bash` (macOS/Linux) or
   `irm … install.ps1 | iex` (Windows). The installer:
   - checks Docker, the GPU and free disk space;
   - verifies the downloaded files against `SHA256SUMS`;
   - generates secrets;
   - pulls the images and starts the stack;
   - waits for `/api/health`, then opens `http://localhost:<VCM_PORT>`.
2. **Upload** (stepper step 1): drag a file onto the drop zone or pick one.
   The client accepts `.mp4 .mov .mkv .webm .avi .m4v`.
3. **Language** (step 2, before anything is sent): "Same as spoken" (the
   default) or one of the thirteen caption languages, shown as cards with
   each language's own name and its English one, and searchable by either
   or by code. The spoken
   language is always auto-detected on upload. The file is then uploaded with
   `caption_language`, and the browser goes to `/editor/{id}`.
4. **Processing** (on the video page): the worker runs
   download model → extract audio → transcribe → translate (if needed) → embed.
   Each stage shows its progress, and an ETA appears once the observed rate
   allows one (`useEta`).
5. **Edit** (optional): caption text, timing on the waveform timeline,
   split/merge/add/delete, the style studio, and a Redo with another
   spoken/caption language. The Redo offers every caption language in a
   searchable picker, with or without a Gemini key, as the language step
   does.
6. **Export** (step 3): MP4 (burned in, at a chosen resolution), SRT, VTT or
   JSON, then a download with an optional file name.

## 6. Features, acceptance criteria and edge cases

### F1. One-command install and the `vcm` command

**Acceptance criteria**
- Running the README one-liner on a machine with Docker running installs and
  starts the app, and opens it. Verified from the published release on a clean
  Linux machine (CPU) and on Windows (GPU) (PROGRESS.md, R6/M13).
- Every downloaded script and compose file must match the release's
  `SHA256SUMS` before anything is replaced; otherwise nothing is installed.
- Running the installer again keeps existing data and secrets.
- `vcm start | stop | restart | status | logs [svc] | update | open | uninstall`
  work as described in `install/vcm` and `install/vcm.ps1`.

**Edge cases (handled in the installers)**
- Docker missing, not running, or (Linux) permission denied: a specific
  message with the fix.
- An NVIDIA driver is present but Docker can't pass the GPU through: a
  warning, then the CPU variant.
- Not enough disk (8 GB for CPU, 12 GB for GPU): the installer stops.
- Port 3000 taken by something else: it tries 3001–3005, 3080 and 8080 in
  turn and says which port it chose. `VCM_PORT` overrides this.
- A file doesn't match `SHA256SUMS`: `*.tmp` files are removed and nothing is
  installed.

### F2. Upload

**Acceptance criteria**
- `POST /api/videos` (multipart: `file`, optional `caption_language`) returns
  `201` with the video, then queues transcription.
- Both the content type and the extension must be on the allow-lists in
  `backend/app/services/storage.py`.
- The stored filename is a UUID, and the user's filename is kept only as a
  label (`build_storage_path`).
- Duration and a thumbnail are probed with FFmpeg. If probing fails, the
  upload is kept without that metadata.

**Edge cases**
| Case | Result |
|---|---|
| Unknown `caption_language` | 422 `Unsupported caption language: …` |
| Content type or extension not allowed | 415 |
| Empty file | 400 `Uploaded file is empty` |
| Over `MAX_UPLOAD_SIZE_MB` (4096 MB by default; counted while streaming, not from `Content-Length`) | 413, partial file deleted |
| Disk full while writing | 507 `The disk is full…`, partial file deleted |
| Queue unreachable after upload | Upload still succeeds; the user retries from the UI |

### F3. Transcription and translation

**Acceptance criteria**
- The Whisper model is chosen by hardware tier unless overridden (see
  [§7](#7-supported-languages-formats-models-and-hardware-tiers)).
- English captions for non-English audio come from Whisper's own `translate`
  task in the same pass.
- Other targets are transcribed first, then translated by Gemini if a key is
  set, and by local M2M100 otherwise.
- Caption timings are never changed by translation.
- The local translator sees whole sentences: captions that make up one
  sentence are translated together and split back over the same captions
  (v1.0.7). Its output is capped at three times the source length and may not
  repeat a four-token phrase.
- Every caption language is one M2M100 itself lists (`M2M100_LANGUAGES`), so
  the core flow works offline.
- Whisper and the translator are never in memory together.
- Long Whisper segments are split into captions of at most 84 characters or
  6 seconds (`_split_long`).
- Verified end to end on GPU (5 spoken languages × 6 targets = 30 jobs) and on
  CPU (3 × 6 = 18 jobs), each exporting SRT/VTT/MP4 (PROGRESS.md, M12, R3,
  v1.0.3 E2E).

**Edge cases**
| Case | Result |
|---|---|
| Gemini fails (no network, quota, bad key) | Local M2M100 is used; notice "Gemini couldn't be used, so the captions were translated on this computer instead." |
| Neither engine can translate | Captions stay in the spoken language, with a notice; the job does **not** fail |
| GPU fails to load the model | Runs on CPU int8; notice "The GPU couldn't be used, so this ran on the CPU." |
| No segment passes Whisper's no-speech check | Retried without it; if that yields captions, a low-confidence notice is shown |
| Out of memory | Failed: "Ran out of memory while transcribing. Choose a smaller speech model in Settings…" |
| Disk full / no audio track / unreadable file / missing source | A specific sentence each (`friendly_error`) |
| Model download blocked by TLS interception | "…put its root certificate (.crt) in the certs folder… run 'vcm restart'" |
| Worker restarted mid-job | Requeued on start, up to 3 times, then failed with the smaller-model advice (§8 of [ARCHITECTURE.md](ARCHITECTURE.md)) |
| Retranscribe while processing | 409 |
| A long job (hours of CPU transcription, a 3 h render) | Never cut off by Celery: no Celery time limit is set, and the worker's `--pool=solo` enforces none. A render is bounded by FFmpeg's own 3 h timeout |

**Failed screen.** Shows the worker's sentence, **Try again**, **Retry with
small model** (only when the model in use isn't already `small`) and **Open
Settings**. Retry with small model makes the two existing calls in order:
`PATCH /api/system/settings {"whisper_model": "small"}`, then
`POST /api/videos/{id}/transcribe`. A note under the buttons says it changes
the speech model for every video until changed back.

### F4. Caption editing

**Acceptance criteria**
- Captions can be edited (text, timing, per-caption colour, bold and scale
  overrides), split at a time and text offset, merged with the next one,
  added by hand, and deleted.
- `start_ms < end_ms` is enforced (422 otherwise).
- Every text change, add, split, merge and delete queues a re-embed of the
  video, so search matches the current text.
- Low-confidence lines are flagged in the editor ("Check this line"), based on
  `captions.confidence`.

### F5. Caption styling

**Acceptance criteria**
- One style per video. Every field must be expressible both in CSS (the
  preview) and in ASS (the burn-in); see the docstring of `CaptionStyle` in
  `backend/app/models/caption_style.py`.
- Built-in fonts: Sans, Serif, Mono, DejaVu, Poppins (default), Lato,
  Barlow Condensed, Anton, Bebas Neue. Presets: `youtube`, `tiktok`,
  `minimal`. The Google Fonts library can also be searched, and a family is
  downloaded the first time it is used.
- Sizes are stored against a 1080p reference and scaled to the output.
- **The preview is the export** (v1.0.7, measured against burned frames):
  - a caption is drawn at libass's size: the preview divides the font size
    by the face's win span (`font_win_span`) and uses it as the line height;
  - one layout rule decides each caption's lines, size and position, in the
    backend (`services/caption_layout.py`) for the burn and in a line-for-line
    copy in the editor (`lib/caption-layout.ts`); libass is handed the lines
    and never wraps or places on its own;
  - Devanagari, Bengali, Tamil and Malayalam are drawn in bundled Noto faces
    in both renderers, at the caption font's em, with complex shaping in the
    burn;
  - a burned box sits where the editor drew it, in its own colour and opacity.
- **The caption box** (v1.0.7):
  - a caption is a box with its own **width**, a fraction of the video's
    width: 80% for landscape and square, 85% for portrait by default. Text
    wraps at that width (minus the padding), never at its distance to an
    edge, and the width never changes because of where the box is;
  - the width is set by dragging the handles on the box's left and right
    edges (mouse, touch, or arrow keys when focused; both edges move,
    keeping the centre) and by the **Max width** slider (20–94%); the two
    stay in sync;
  - **Max lines** (1, 2 or 3; default 2): a caption that needs more lines at
    that width is drawn smaller, in 2% steps, down to 70% of the chosen
    size; if it still doesn't fit it gets one extra line, at the largest
    size that fits in it, and past that keeps every line it needs. Text is
    never cut. A word wider than the box is broken (never before a mark or
    after a virama);
  - the position is the box's **centre** (`pos_x`, `pos_y`);
  - each caption's whole painted rectangle (lines, box padding or outline,
    shadow, and glyph overhang) is slid inside a **safe area** 3% from every
    edge, after layout, every time: while dragging, with the keys, after a
    font, size, padding or width change, and for every caption of the video
    on its own. It slides; it never shrinks or rewraps because of an edge;
  - **snapping:** while dragging, the box snaps when its centre comes within
    8 px of the frame's horizontal or vertical centre, with a guide line;
    a guide also shows at the safe area's edge the box is pushed against;
  - **Top / Middle / Bottom** centre the box horizontally at 12%, 50% or 88%
    of the height; presets and Reset centre it at the bottom (or middle) with
    the default width and line count.
- **Line control** (v1.0.8):
  - **manual line breaks:** Shift+Enter in a caption's text inserts a line
    break (Enter still saves). It is saved with the caption, shown in the
    preview, burned there in the MP4 and written into SRT and VTT as a real
    line break; a manual line still too wide for the box also wraps by width
    inside itself;
  - **Line style**, for the whole video, beside Max width and Max lines, each
    with its one-line description in the panel:
    - **Balanced** (default, and what every caption did before v1.0.8):
      wraps at the box width with the lines evened out;
    - **Auto:** fills each line to the box width before starting the next;
    - **Stacked:** **Words per line** (1–4, default 2) words a line, whatever
      the box width, unless a group is still too wide for the box (then it
      wraps). In Stacked, Max lines is 1–6, default 4;
  - **fit rule** (every style): a caption that needs more than Max lines
    shrinks to 70% of the chosen size, then gets extra lines; if its box is
    then taller (or wider) than the safe area, it keeps shrinking until it
    fits. Text is never cut, and the box stays inside the 3% safe area;
  - SRT and VTT break each caption into the burn's lines, laid out on the
    video's own frame, in the words' own letter case;
  - a **Redo** in the same caption language keeps the manual breaks of every
    caption that comes back with exactly the same words; a new translation,
    or changed words, starts without them.
- **Moving it:** drag the caption anywhere on the frame or by its grab
  handle (a 28 px dot on its top edge, mouse or touch); with the handle
  focused, arrow keys move it 1% of the frame and Shift+arrow 10%. A drag
  saves the centre it asked for (inside the frame), so a caption dragged
  against an edge saves "against that edge" and a shorter one sits there too.
- **Sliders** move with the pointer, the arrow keys and a click; controls
  that have no effect (a colour with nothing to colour) stay in place,
  greyed out, rather than appearing and disappearing.

### F6. Export

**Acceptance criteria**
- SRT, VTT and JSON are written immediately and come back `completed`.
- MP4 is queued to the worker. The client polls every 1.5 s while a render
  runs.
- MP4 can be rendered at 360/480/720/1080/1440/2160 p plus the source height.
  The default resolution is the smallest one at which captions are at least
  24 px tall (`recommended_height`), and it is never below the source height.
- Encoding uses NVENC when it is available, and x264 (CRF 18) otherwise.
- A download needs a short-lived token (15 min) bound to one export.
- Sidecars are named exactly after the video (`movie.srt`). A burn gets
  `-captions.mp4`. A name the user types replaces both.
- Deleting a video deletes its export files as well as their rows.

**Edge cases**: export with no captions → 409. Download of an export that
isn't finished → 409. Render queue unreachable → 503, and the export row is
removed.

### F7. Semantic search

**Acceptance criteria**
- `GET /api/search?q=` searches all of the user's videos, or one video with
  `video_id`.
- Results carry timestamps, and clicking one jumps there.
- Hits with a cosine distance over 0.75 are dropped (`MAX_DISTANCE`).
- **Retrieval-only by default.** `POST /api/ask` writes an answer only when a
  Gemini key is set. Without one it **always** says so ("Written answers need
  a Gemini API key, which you can add in Settings. The matching moments are
  below."), whether or not anything matched. It never claims the video has no
  answer when no model was asked.
- With a key, a question the video doesn't answer must return
  "I couldn't find an answer to that in this video." rather than an invention
  (`backend/app/services/rag.py`).

### F8. Settings

**Acceptance criteria**
- Shows the hardware the worker detected, the speech model in use and its
  source (`user`/`env`/`auto`), the translation engine, the disk and the
  theme.
- Interface theme: **Light**, **Dark** or **System** (the default). System
  follows the OS, including a change while the app is open. The header's
  theme button flips to an explicit Light or Dark.
- The speech model can be `auto`, `small`, `medium`, `large-v3-turbo` or
  `large-v3`. Anything else is rejected with 422.
- The Gemini key can be set or cleared, **only here** on an install. It is
  stored server-side, **never returned** by any response (only
  `gemini_configured` and `gemini_source` are), and **never logged**
  (database statements are logged without their values).
- Install settings can only be changed in local mode (403 in accounts mode).

### F9. Update and uninstall

**Acceptance criteria**
- `vcm update` verifies `SHA256SUMS`, pulls the images, recreates the
  containers and runs `alembic upgrade head` on API start. Videos, captions
  and the database are kept (verified in R5 and on every release since).
- The update downloads only the image layers that changed: 1.0.3 → 1.0.4
  downloaded 0 of 14 backend layers and 3 of 9 frontend layers, 6.1 MB
  (PROGRESS.md).
- `vcm uninstall` asks first. Typing `DELETE` removes the containers, volumes,
  app images, install folder and `vcm` command. Anything else keeps the
  `vcm_*` volumes and the install folder, which holds the password the kept
  data needs.
- Uninstall only removes images named `/video-caption-maker-`. The shared
  postgres, redis and chroma images are never removed.

## 7. Supported languages, formats, models and hardware tiers

### Languages (`backend/app/services/languages.py`)

| Code | Caption target | Notes |
|---|---|---|
| `same` | yes (default) | Captions in whatever language Whisper detected. **Any** language Whisper recognises. |
| `en` | yes | From non-English audio: Whisper `task="translate"` in the same pass |
| `hi`, `bn`, `mr`, `ta`, `ml`, `fr`, `de`, `nl`, `es`, `pt`, `it`, `ru` | yes | Transcribe, then translate (Gemini or M2M100). Weak locally: the Indian languages (Tamil and Malayalam most), see §10 |
| `auto` | spoken-language value | Default for `spoken_language`; Whisper detects from the first 30 s |

### Input formats
`.mp4 .mov .mkv .webm .avi .m4v`, with content types `video/mp4`,
`video/quicktime`, `video/x-matroska`, `video/webm`, `video/x-msvideo` and
`video/x-m4v`. Upload limit: `MAX_UPLOAD_SIZE_MB`, **4096 MB** (the code and
the production compose agree).

### Output formats
| Format | How | Media type |
|---|---|---|
| SRT | instant | `application/x-subrip` |
| VTT | instant | `text/vtt` |
| JSON | instant (milliseconds as integers, emphasis included) | `application/json` |
| MP4 | worker render, H.264 (NVENC or x264), audio kept | `video/mp4` |

### Models
| Model | Use | Licence | Download |
|---|---|---|---|
| Whisper `small` / `medium` / `large-v3-turbo` / `large-v3` (faster-whisper, CTranslate2) | speech | MIT | 484 / 1530 / 1620 / 3090 MB (`WHISPER_SIZES_MB`) |
| M2M100 1.2B / 418M (`jncraton/*-ct2-int8`, pinned commits) | translation | MIT | 1260 / 500 MB |
| `sentence-transformers/all-MiniLM-L6-v2` | search embeddings | Apache-2.0 | ~90 MB (README) |
| Gemini (`gemini-flash-latest`) | optional translation and answers | Google API terms | none (remote) |

### Hardware tiers (`backend/app/services/hardware.py`)
| Machine | Whisper | Compute | Translator |
|---|---|---|---|
| NVIDIA GPU with ≥ 6 GB VRAM (or unknown VRAM) | `large-v3` | float16 | M2M100 by RAM, on the GPU (int8_float16) |
| GPU with < 6 GB VRAM | `small` | int8_float16 | M2M100 by RAM |
| CPU, ≥ 12 GB RAM | `large-v3-turbo` | int8 | `m2m100_1.2B` (int8) |
| CPU, < 12 GB RAM | `small` | int8 | `m2m100_418M` (int8) |

RAM is the smaller of the machine's memory and the container's cgroup
limit. The precedence is Settings, then `WHISPER_MODEL_SIZE`, then the tier.
macOS always runs on the CPU.

## 8. Non-goals

What the code deliberately does not do:

- **No login, accounts or multi-user use in the shipped build.** The code for
  accounts mode (registration, JWT, Google sign-in, password change, delete
  account) is kept for a hosted build (`AUTH_MODE=accounts` plus
  `NEXT_PUBLIC_AUTH_MODE=accounts`). It isn't shipped or offered.
- **No LLM rewriting of transcripts.** Captions stay what Whisper heard. Gemini
  only translates (when asked) and answers questions (docs/MILESTONES.md, "Where
  Gemini fits").
- **No network exposure.** Only the UI port is published, and only on
  `127.0.0.1` (`docker-compose.prod.yml`).
- **No caption language that isn't checked end to end.** Thirteen targets
  (v1.0.7); others only after the checks in TESTING.md "Adding a caption
  language", and right-to-left and CJK are planned work
  ([ROADMAP.md](ROADMAP.md)). "Same as spoken" is the route to the rest.
- **No term highlighting in search.** Semantic matches have no matched words
  (PROGRESS.md, v1.0.4).
- **No features without data behind them.** The v1.0.4 redesign left out the
  design's app-version chip, live transcript, cancel button, memory figures,
  cache clearing and inference-speed tiles, because no API supplies them
  (PROGRESS.md, v1.0.4 redesign log). The "System" theme was added in v1.0.5.
- **No re-encoding of the source.** The upload is stored and streamed byte for
  byte. Only the MP4 export is an encode.

## 9. Constraints

- **Must run** on a CPU-only machine with 8 GB of RAM, and on Windows (WSL 2),
  Linux and macOS via Docker.
- **Must never** keep Whisper and the translator in memory together.
- **Must not** need the internet for the core flow once the models are
  downloaded. Gemini, Google Fonts on demand, model downloads and image pulls
  are the only network uses (see [SECURITY.md](SECURITY.md)).
- **Must** keep `.env`, `certs/`, storage and dumps out of every image, commit
  and release (allow-list `backend/Dockerfile.dockerignore`, `.gitignore`).
- **Must** use permissively licensed models (MIT/Apache-2.0); see
  [DECISIONS.md](DECISIONS.md).
- **One worker, one job at a time** (`--pool=solo`).
- **Images:** amd64 only (built on `ubuntu-latest`); Apple Silicon runs them
  under emulation (README).

## 10. Known limitations

From the README "Known limitations" and PROGRESS.md:

- **macOS is untested, and stays so** until a Mac is available. The installer
  and images are meant to work with Docker Desktop for Mac, but no one has run
  them there. On a Mac everything
  runs on the CPU, and Apple Silicon runs the amd64 images under emulation,
  which is slow.
- **The small speech model is weak on fast non-English speech, especially
  Hindi.** `small` is chosen automatically on machines under 12 GB of RAM (or
  GPUs under 6 GB). On a low-RAM Hindi test it first produced no captions at
  all. Since `b8c446a` it retries and produces rough captions, with the
  low-confidence notice on 4 of 6 jobs (PROGRESS.md, R4). A larger model in
  Settings is much better if the machine has the memory.
- **Local translation is literal, and weak for the Indian languages.** M2M100
  translates a sentence at a time, so idioms still read literally, and a
  sentence split back over its captions can break inside a phrase
  ("…und eine | Tasse Wasser…"). Into Hindi, Bengali, Marathi, Tamil and
  Malayalam the script, timing and sentence shape are right but everyday
  nouns often are not ("onions" became "apples", "soap" or "sugar"); Tamil
  and Malayalam are the weakest added, and Hindi is weaker as a source than
  as a target. Samples per pair are in PROGRESS.md (v1.0.7). Gemini, with a
  key and quota, is much better.
- **Text can sit a pixel or two higher or lower inside its line in the
  preview than in the export.** The lines, the size and the box are the
  same (one layout rule); each renderer places the baseline within the line
  by its own font metrics.
- **Languages left out (v1.0.7):** Telugu is not in M2M100; Kannada, Gujarati
  and Punjabi came out of it unusable (invented text, wrong script); Arabic
  and Urdu need right-to-left rendering, Chinese, Japanese and Korean need
  CJK fonts and line breaking ([ROADMAP.md](ROADMAP.md)).
- **Burned-in captions in Chinese, Japanese or Korean need a font picked by
  hand.**
  It applies when **"Same as spoken"** is used on Chinese, Japanese or Korean
  audio (none of the thirteen caption targets is CJK). Whisper then produces captions in that script, and the image's
  fallback fonts (`fonts-noto-core`, DejaVu, Liberation) have no CJK glyphs:
  `fc-list :lang=ja`, `:lang=ko` and `:lang=zh-cn` each return 0 families in
  the worker image, while `:lang=hi` returns 2. Without a CJK font chosen in
  the style panel (the Google Fonts library has some, e.g. the Nanum and Zen
  families), libass draws empty boxes in the MP4. SRT/VTT/JSON exports are
  unaffected.
- **CPU transcription is slow:** roughly real time with the default model
  (README, Troubleshooting).

## 11. Definition of done

A change is done when all of these hold (from the working rules in
PROGRESS.md and [AGENTS.md](../AGENTS.md)):

1. **Scope.** It does only what was asked. UI work restyles without changing
   logic, and shows no mock data: every figure comes from the API.
2. **Backend.** `ruff check app tests alembic scripts` and
   `docker compose exec backend python -m pytest` pass (the suite uses its own
   `_test` database, never the dev one; see [TESTING.md](TESTING.md)). Both
   also run in CI.
3. **Frontend.** `npm run lint`, `npm run type-check` and `npm run build`
   pass. These also run in CI (`.github/workflows/ci.yml`).
4. **Scripts.** `bash -n` and `shellcheck -S warning` pass for
   `install/install.sh` and `install/vcm`, and both compose files pass
   `docker compose config -q` (CI).
5. **UI changes.**
   - Screenshots at 375 px and 1440 px in light and dark
     (`scripts/ui-check`).
   - axe-core reports 0 WCAG 2 A/AA violations.
   - Every keyboard stop shows a visible focus ring.
   - No horizontal overflow at 375 px.
6. **End-to-end flows.** Changes to the pipeline, the installer or the
   release are verified with `scripts/e2e.py` against a running install, and
   on a clean machine for installer changes.
7. **Docs.** The affected docs in `docs/` and PROGRESS.md are updated.
8. **Commit.** It is committed in small groups (at most ~5 files), with no
   secrets, no `.env`, no certificates and nothing from `design/stitch/`.

## Decisions recorded

Answers from the maintainer (2026-10-14) to the questions this document used
to list:

| Question | Answer |
|---|---|
| Who is the product for? | Individual creators, students and small teams who want private, offline captions and translation, especially Hindi ↔ English (§3). |
| More caption languages? | Out of scope for now; possible in future ([ROADMAP.md](ROADMAP.md)). |
| Hindi/French/German/Dutch disabled in the editor's Redo without an env key | A bug, fixed in v1.0.5: all five are offered offline, as on the language step. `translation_available` is always true. |
| macOS | Stays "untested" (no Mac available). |
| Accounts mode | Not an active direction; kept and documented as an optional future hosted mode. |
