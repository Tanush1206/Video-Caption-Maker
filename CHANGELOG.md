# Changelog

All notable changes to VideoCaptionMaker. Versions are the git tags. Dates
are when the GitHub Release was published. Each entry is drawn from the
commits between tags; hashes are given for reference.

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- **The last two copies of the distrusted emSign roots are gone.** pip's
  own certificate list now links to the system one, and gRPC (used by the
  search database's telemetry library) reads the system list instead of its
  built-in one. A small layer: the update stays small.
- **Next.js 15.5** (15.5.28, from 14.2.35) with **React 19.2.9**: the
  remaining Next 14 server advisories (docs/LAUNCH_AUDIT.md S1) no longer
  apply. Next 15's optional image library (sharp, with an LGPL libvips
  binary) is left out of the image: the app never optimises images.

### Fixed
- **Large and slow uploads.** An upload now streams through the app in
  constant memory: until now the whole video sat in memory on its way (about
  4 GB of RAM for a 4 GB file), and Next 15 would have cut anything over
  10 MB. An upload that takes longer than five minutes is no longer cut off,
  and cancelling one frees its partial file at once. Checked with a 2 GB
  upload and a 360 MB one at 1 MB/s.
- **Alignment no longer moves a caption.** Left, Centre and Right now only
  set the lines against each other inside the caption, which is as wide as
  its longest line; the caption stays exactly where it is on the video, in
  the editor and in the MP4. A caption's position is its left edge on Left,
  its centre on Centre and its right edge on Right, so left-aligned captions
  of different lengths line up on the left. Existing videos look exactly as
  before (migration `e8b3d5f19a42`; checked byte for byte against 360 burns
  made by 1.1.1).
- **The app no longer stalls while a font downloads.** A first download from
  Google held up every other request, the style save included.

### Added
- The Font field says "Downloading font… this can take a few seconds the
  first time." while a new font downloads, and says so in plain words if the
  download fails. Neither message sits next to Reset.
- **Undo after Reset**, for 10 seconds. Reset is one click, so taking it back
  is one click too. A tab that regains focus reads the style again, so it
  never shows a style an export won't use.
- Tests that SRT and VTT break exactly where the MP4 does for the line style
  at export time (Balanced, Auto, Stacked, manual breaks). The SRT on one
  line reported against 1.1.1 came from a Reset just before the export, not
  from the export.

## [1.1.1] - 2026-10-27

Security, safety and legal fixes from the launch-readiness audit
(docs/LAUNCH_AUDIT.md). No migration. The update downloads the app layers
and a small new layer; the large Python and system layers are unchanged.

### Security
- **FFmpeg opens only what the app needs.** Every run on an upload reads
  local files only, in the six accepted containers, with common video and
  audio codecs, and names the main picture and sound. Playlists, concat
  lists, CAF and the PNG, Dirac, CFHD, VobSub, PGS and DVB parsers (where
  Debian's FFmpeg has unfixed code-execution CVEs) are never reached. A cover
  image or picture subtitles next to a real video are skipped and noted on
  the video; a file whose only picture is a cover image, or whose picture is
  in another codec, is refused at upload.
- **The backend and worker run as an unprivileged user** (`vcm`), with no
  capabilities and `no-new-privileges`; the frontend drops all capabilities.
  An update from 1.1.0 hands the existing videos, models and fonts to the new
  user on the first start.
- **The app can't be framed by another site** (clickjacking), and every
  response carries a Content-Security-Policy, `X-Frame-Options`,
  `nosniff`, `Referrer-Policy` and `Permissions-Policy`.
- **The frontend refuses requests from other sites** other than a link, and
  a Host that isn't this computer; the unused image optimiser is gone. This
  mitigates the Next.js 14 advisories a web page could reach until the Next
  upgrade (v1.2.0).
- **Search no longer contacts Hugging Face on every start**: the model loads
  from the local copy, pinned to a commit, as SECURITY.md always said.
- **The distrusted emSign root certificates** are removed from the system
  store and from certifi.
- **`vcm update` removes only this app's old images**, never another
  project's; the installers no longer suggest `docker system prune`.
- Every GitHub Action is pinned to a commit.

### Added
- **THIRD_PARTY_NOTICES.md**, and `/licenses` in every image: each
  package's licence files, the fonts' OFL, and a GPL source offer listing
  every Debian (or Alpine) source package at its exact version with a link to
  that source.
- **PRIVACY.md** and a privacy page on the website: what leaves the computer
  and when, Gemini's terms for free keys, age and region, and the site's
  analytics. Settings says the same under the Gemini key.
- "No warranty" and "only caption videos you have the right to use" in the
  README and on the website; the site's link-preview image, canonical URL,
  structured data, sitemap and apple-touch-icon.

### Changed
- **Plain error messages with a next step**, e.g. "This file type isn't
  supported. Try MP4, MOV, MKV or WebM (AVI and M4V work too)." instead of
  "Unsupported content type: video/x-ms-wmv".

## [1.1.0] - 2026-10-26

A new look: minimal and calm, like Apple's own apps. Nothing about how the
app works changed; every screen was restyled. No migration. The update
size is measured when the install is updated.

### Changed
- **The whole interface**, light and dark: white (or black) pages and soft
  grey groups instead of boxes and borders, one blue for the one main
  action on a screen, the system font (no web fonts to load), and
  monospace only for timestamps. Every screen meets WCAG AA, with a 2 px
  focus ring for the keyboard.
- **Videos:** a short upload area, then a grid of rounded thumbnails with
  one grey line under each ("Hindi · 3:48 · Ready"); open, search and
  delete are in a "…" menu, and delete asks first. The filters are a
  segmented control. The counts line is just "6 videos · 1.2 GB"; footage,
  captions and the queue moved to Settings → Storage.
- **Header:** Videos, Search and Settings as plain tabs; the hardware chips
  and the theme button moved to Settings. On a phone they're a tab bar at
  the bottom. The footer shows the version.
- **Editor:** the video large on a grey stage; one quiet player row, with
  volume and speed (0.5–2×) in small pop-ups; the inspector is one
  control (Captions · Typography · Appearance · Position) over grouped
  settings; a denser caption list (about eight lines at 1440 px); the
  timeline's view follows the playhead (a sideways swipe or Shift+scroll
  pans it). The caption box's handles show only when you're near it, and
  the two helper lines became tips shown once.
- **Editor on a phone:** no app header (the editor's own bar has back,
  title and Export), and the bottom sheet shows the caption that's playing,
  editable with a tap.
- **Language step, processing, failed, export, search and settings** are
  grouped lists in the same style; Settings is one column (Your computer,
  Speech model, Translation, Gemini, Storage, Appearance), and now lists
  the computer's graphics, memory and model in use.

- **Export resolutions stop at the video's own size.** A 1080p video is
  offered 360p to 1080p, and the default is its own size; upscaling is no
  longer offered (it added no detail, only a bigger file and a longer
  encode), and the API refuses a height above the source.
- **Speech models:** Settings offers Automatic, Small, Large v3 Turbo and
  Large v3. Medium is gone: as big as Large v3 Turbo, slower, and less
  accurate on Hindi. An install that had chosen it goes back to Automatic.
- **While a video is processed** the steps read Upload, Language,
  Captions, Export, with Captions current.

### Added
- **The Hinglish model in Settings:** whether it's downloaded, and its size.
- **During a Redo** the caption list says "Showing the previous captions
  until the new ones are ready."
- `version` and `hinglish_model` in `GET /api/system`.

### Fixed
- The language step's "Hindi captions in" choice had no visible selection;
  it now has the same radio and blue outline as the caption languages.

## [1.0.11] - 2026-10-23

Quiet recordings get captions, and the languages offered are the ones that
work. No migration. Updating from 1.0.10 downloads 7.4 MB (measured on the
Windows GPU install: backend 3 of 15 layers, 0.2 MB; frontend 4 of 10,
7.2 MB); no dependency layer changes.

### Fixed
- **Quiet recordings got no captions.** A video whose speech stayed under
  -40 dB (a quiet or distant microphone) had everything thrown away as
  invented over silence, and finished with no captions and no word why
  (27 of 50 English test clips). When the usual level would count most of
  the speech as silence, silence is now judged against how loud the
  recording itself speaks.
- **"No speech was found in this video."** A video that still ends with no
  captions says so on its page.

### Removed
- **Tamil, Marathi, Bengali and Malayalam** as caption and spoken
  languages. Measured on Google's FLEURS speech set they were heard and
  translated poorly (63-122% of words wrong; Malayalam in the wrong
  script); see docs/LANGUAGE_QUALITY.md. Videos already made in them keep
  their captions and still export; their Redo asks for another language.
  They're planned to return with Indian-language speech models.

### Changed
- **Speech in a language the app doesn't support** is said up front:
  "Tamil speech isn't supported yet, so captions would be inaccurate.",
  with a choice of the spoken language or "Try anyway (low quality)". The
  video's page repeats the warning on captions made that way.
- The "Hindi or Marathi?" question is gone: Marathi heard gets the same
  warning, and Hindi can be chosen there.

## [1.0.10] - 2026-10-22

Captions for every stretch of speech. No migration. Updating from 1.0.9
downloads 7.4 MB (measured on the Windows GPU install: backend 3 of 15
layers, 0.2 MB; frontend 4 of 10, 7.2 MB); no dependency layer changes.

### Fixed
- **Speech with no caption.** A stretch of 1–2.5 s where someone was
  speaking could be left without a caption (two on the Hindi tutorial with
  the large speech model, at 25 s and 77 s). Short stretches of speech are
  now listened to again on their own; one that was found but thrown away
  over a timing rounding is kept; and words heard on both sides of a join
  are said once. Speech that still can't be made out is left empty rather
  than guessed. Captions made before keep their gaps until a Redo.
- **Redo offered no Hinglish for older videos.** A video captioned before
  v1.0.9 had no language recorded, so the editor's Redo didn't offer
  "Hindi in" and stayed in Devanagari. It's offered now unless the video is
  known not to be Hindi.

## [1.0.9] - 2026-10-21

Hindi in Roman script ("Hinglish"), chosen before anything is transcribed,
and captions that start when their words do. **One migration**, run on
start: videos gain how Hindi is written, what was heard, and a "held" flag;
every existing video keeps its captions exactly as they are.
Update from 1.0.8: **7.4 MB**, measured on the Windows GPU install
(backend 0.2 MB, frontend 7.2 MB); no dependency layer changes. The
Hinglish models (1.5 GB and 138 MB) download only when first used.

### Added
- **Hinglish captions.** Hindi can now be captioned in Latin letters, with
  English words in English spelling ("To video mein captions auto
  generate"), by a speech model made for it (Oriserve's Apex). On a 228 s
  Hinglish tutorial it got 65 of 73 English words right where the old
  model got 12, made far fewer mistakes overall, and ran in 8 s instead of
  109 s on a GPU. It downloads once, 1.5 GB, the first time it's used, and
  the language step says so.
- **The language step listens first.** The video starts uploading as soon
  as you pick it, and the app hears what language it is while you choose
  the caption language. When it's Hindi it asks "Hindi captions in:
  Hinglish (Roman) / हिन्दी (Devanagari)", set to Hinglish when it is sure;
  when it isn't sure, or hears Marathi, it asks you to choose. Back, or
  closing the page, deletes the upload.
- **Redo** offers "Hindi in" for videos heard as Hindi.
- Translations of Hinglish into other languages go through Devanagari
  first (IndicXlit, a 138 MB download on first use), because the
  translator can't read Roman Hinglish. English captions are still made by
  the speech model itself.

### Fixed
- **Captions came up late, by up to 2.6 s** (v1.0.8, on a Hindi talk after
  Redo). A segment whose first words were cut off at its start, and so no
  longer matched its text, was spread over the whole stretch of speech
  around it. Every word is now timed on its own and each caption starts on
  its first word. On the Hindi tutorial the worst caption went from 2.61 s
  late to 0.13 s. Captions made before the fix keep their timings until you
  press Redo.
- A word Whisper placed in the pause before it (up to 0.5 s early) now starts
  where the voice comes back.

## [1.0.8] - 2026-10-19

Caption line control, and captions that follow the speech in every
language. **Three migrations**, run on start: every style gets the Balanced
line style and 2 words a line (how every caption already broke, so existing
videos look exactly as before); exports record which captions they hold;
videos keep the word timings their captions are timed to.
Expected update from 1.0.7: about 8 MB (backend app code; frontend app
layers ~7 MB); no dependency layer changes. Measured after release.

### Added
- **Manual line breaks.** Shift+Enter in a caption's text starts a new line
  there (Enter still saves). The break is saved, shown in the editor, burned
  at the same place in the MP4 and written into SRT and VTT; a manual line
  still too wide for the box also wraps inside itself.
- **Line style** in the style panel's Position tab, for the whole video, each
  option with a one-line description:
  - **Balanced** (default): wraps at the box width with the lines evened out,
    as before;
  - **Auto:** fills each line to the box width before starting the next;
  - **Stacked:** a set number of words on each line (**Words per line** 1–4,
    default 2), whatever the box width, unless a group is still too wide for
    the box. Max lines goes up to 6 in Stacked (default 4).

### Changed
- **SRT and VTT break each caption where the burned MP4 does**, laid out on
  the video's own frame, in the words' own letter case. They used to hold
  each caption on one line.
- **A caption taller than the frame keeps shrinking until it fits.** Past
  Max lines a caption shrinks to 70%, then gets more lines; if its box would
  then be taller (or wider) than the safe area, the font keeps shrinking,
  so no caption is ever cut off, even one word a line.
- **Redo keeps manual line breaks** of every caption that comes back with
  exactly the same words, when the caption language is unchanged. A new
  translation starts without them.
- **Captions are phrases timed to the speech, in every language.** A
  caption is about 32 characters, cut at punctuation, then at natural word
  groups (never starting with a word that finishes the verb before it, such
  as है or आहे), never a lone word. Its timing comes from Whisper's word
  timestamps: whatever is spoken is on screen, a breath under 0.5 s closes
  to two frames (no flicker), 0.5 s or more of silence stays a gap, and a
  caption lasts 0.8–7 s, ending at most 0.5 s after its last word. Editing a
  caption's timing by hand is kept until Redo.

### Fixed
- **An SRT downloaded after switching language could be the old
  language.** Exports made before a Redo stayed in the list unlabelled, so an
  English SRT was downloaded as the Hindi one. Every export now says which
  caption language it holds, and one made from captions a Redo has since
  replaced is marked "From earlier captions".
- **JSON exports escaped non-Latin text** (`\u0924\u094d…` instead of
  Marathi). Written as UTF-8 with the real characters.
- **Translated captions became single words held for 13–15 s and sentences
  were cut mid-phrase** (Marathi: 76 captions to English's 116; the editor
  timeline showed gaps while speech went on). Three causes: Whisper skipped
  stretches of speech (20 s at a time on a Hinglish tutorial; they are now
  decoded again on their own), word alignment stretched a word across the
  pause after it (now capped at 3 s), and translated sentences were forced
  back into their source's caption slots (now re-cut into phrases and timed
  to the words). On that tutorial Hindi, Marathi and Spanish now have
  0.93–1.09 of English's caption count, 0–2 single words and nothing over
  4.8 s.

## [1.0.7] - 2026-10-17

Caption placement and styling fixed and made to match the export exactly,
better local translation, and eight more caption languages. **One
migration** (`c8f2a6d41e93`), run automatically on start: every saved caption
position is converted to the new caption box (below), so existing videos keep
their place. Update from 1.0.6, measured on the Windows GPU install: **11.8
MB** (backend CUDA 9/15 layers, 4.6 MB: HarfBuzz 2.2 MB, fonts 2.2 MB, app
code; frontend 4/10 layers, 7.2 MB); the 2 GB dependency layer is reused.

### Added
- **The caption box.** A caption is now a box with its own width, as in
  VEED and broadcast captions:
  - text wraps at the box's width, never at its distance to an edge, and the
    width doesn't change wherever the box is dragged;
  - drag the handles on the box's left and right edges, or use the new
    **Max width** slider (20–94%; default 80% landscape, 85% portrait);
  - **Max lines** (1, 2 or 3; default 2): a caption that needs more is drawn
    smaller, down to 70%, then gets one extra line; text is never cut, and a
    word longer than the box is broken;
  - every caption, whatever its length, is kept 3% inside every edge of the
    frame, with its padding, outline and shadow;
  - snapping with guide lines at the frame's centre and at the safe area;
  - **Top / Middle / Bottom** and **Left / Centre / Right** replace the
    nine-cell placement grid and the edge and side margins
  (`5d74af5`, `af1ed90`, `247403e`, `64d079a`, `93abaa5`).
- **Eight caption languages:** Bengali, Marathi, Tamil, Malayalam, Spanish,
  Portuguese, Italian and Russian, all translated locally by M2M100 and
  burned with correct shaping. Each was checked against M2M100's own
  language list, a translation sweep and a burned export (`2df958e`).
- **Searchable language pickers** showing each language's own name and its
  English one: the language step gains a search field over its cards, and
  the editor's Redo language becomes a searchable picker (`2548aeb`,
  `8403e17`). Settings lists the served languages (`c8dc44a`).
- **A grab handle on the caption** (the dot from the editor mockup): drag
  it by mouse or touch, or focus it and move the caption with the arrow keys
  (1% of the frame, Shift 10%) (`7100933`).
- **Noto Sans Devanagari, Bengali, Tamil and Malayalam** bundled (OFL), so
  the preview and the export draw those scripts from the same files
  (`af21ba2`, `40113f6`), and **Noto Sans** for Cyrillic in caption fonts
  that have none, such as the default Poppins (`069d74a`).

### Changed
- **Local translation works a sentence at a time.** Captions that make up
  one sentence are translated together and split back over the same
  captions, so continuations are no longer capitalised as new sentences and
  German or Dutch verbs land in the right caption. Timings are unchanged.
  Output is capped at three times the source length and may not repeat a
  phrase, which stops runaway output (`8a03582`).
- **The preview draws captions at the size the export burns them.** libass
  makes the font size the font's whole cell; the browser made it the em, so
  captions were up to 1.76x larger in the editor than in the MP4 (Poppins
  Bold) and wrapped differently. Now within about 1% in width (`d42bc07`,
  `13413c3`). **Captions will look smaller in the editor than before; that
  is the size they always had in exports.**
- **The preview and the export lay captions out with one rule.** The lines,
  size and position are worked out once (the same rule in the backend and,
  line for line, in the editor) and handed to libass, which no longer wraps
  or places captions on its own. Measured the same lines and the same box
  within 0.5% of the frame for 16:9, 9:16 and 1:1 video (`af1ed90`,
  `247403e`).
- **Existing captions get the default width** (80% of a landscape frame),
  so a long caption that filled nearly the whole width before may now take
  one more line.
- **Indic text uses the same font and size in the preview and the export**
  (`0edbf20`), and so does Russian in a caption font without Cyrillic, which
  burned about 1.3x the size of the Latin beside it (`0900c29`, `6ed3501`).

### Fixed
- **Style sliders snapped back and jumped while dragged.** A click or arrow
  key reset the thumb to the old value for a render; dragging Opacity off 0
  moved the slider out from under the pointer as other controls appeared.
  Controls that have no effect are now greyed out instead of removed
  (`1fbd57d`).
- **A dragged caption could leave the frame and change size** near the
  edges, and jumped a few pixels on grab (`8445fda`). Dragged to the right
  edge it wrapped to one word per line (1.0.6); at the left or top its box,
  outline or shadow was cut off, and a box with padding 0 overflowed the
  bottom. Fixed by the caption box (`af1ed90`, `64d079a`).
- **A translucent box behind Hindi (or any caption mixing fonts) burned as
  overlapping boxes**, darker where they overlapped. The box is now drawn as
  one rectangle under the text, exactly the one the editor shows.
- **Reset and every preset kept a dragged caption's position** (`688506f`).
- **The first frames of a drag didn't move the caption vertically**, and
  arrow keys on the editor also seeked the video (`7100933`).
- **Burned caption boxes ignored their colour and opacity:** every box came
  out in the outline colour at 100% (the YouTube preset's 75% box was solid)
  (`489d6f3`).
- **Indic scripts were burned unshaped:** Hindi vowel signs after their
  consonant, conjuncts broken, Bengali/Tamil/Malayalam vowels split round a
  dotted circle. The burn now uses complex shaping (`9cf0b84`).

### Not added, and why
- **Telugu:** not in M2M100's language list, and Gemini-only languages are
  not offered.
- **Kannada, Gujarati, Punjabi:** M2M100's output was unusable (invented
  text, wrong script, a reversed meaning). Samples in PROGRESS.md.
- **Arabic, Urdu** (right-to-left) and **Chinese, Japanese, Korean** (CJK
  fonts and line breaking): planned, see docs/ROADMAP.md.

### Known limitations
- Translation into the Indian languages is weak locally: script, timing and
  sentence shape are right, everyday nouns often aren't; Tamil and Malayalam
  most. A sentence split back over captions can break inside a phrase.

## [1.0.6] - 2026-10-15

A security fix in the frontend only; no backend code change and no
migration. Updating from 1.0.5 downloads about 6.1 MB, all frontend; the
backend downloads nothing.

### Fixed
- **A caller could forge `audit.log`'s client address through the UI
  port.** Next's `/api` proxy passed a caller's `X-Forwarded-For` (and
  `-Proto`) to the API, which trusts the frontend. The frontend now
  overwrites both with its own socket's peer before proxying
  (`frontend/forwarded-for.js`). For a browser on the same computer, that
  peer is Docker's gateway. Tested in `frontend/tests/`, which CI now runs
  (`npm test`) (`16b8747`, `4f8ac57`, `5fd32c2`).

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

[1.0.7]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/Tanush1206/Video-Caption-Maker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/Tanush1206/Video-Caption-Maker/releases/tag/v1.0.0
