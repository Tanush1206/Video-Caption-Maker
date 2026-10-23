# Roadmap

Work that has been **decided for later** and is **not built**. Nothing here
describes current behaviour. When an item ships, move it to CHANGELOG.md and
the relevant doc, and delete it here.

The original 10-milestone build plan is historical and lives in
[MILESTONES.md](MILESTONES.md).

## Later

### `vcm backup` and `vcm restore`
- **What:** one command each, wrapping the manual procedure in
  [DATABASE.md §7](DATABASE.md#7-backup-and-restore):
  - quiesce the backend, worker and frontend;
  - `pg_dump -Fc` the database;
  - archive the `vcm_media` volume;
  - keep `.env` with the backup;
  - restore with `pg_restore --clean --if-exists`, then start the stack so
    migrations run.
- **Why:** the manual procedure works (tested 2026-10-14), but a user
  shouldn't have to type Docker commands to keep their videos safe.
- **Must:** work in both `install/vcm` and `install/vcm.ps1`; refuse to
  restore a dump from a newer schema; never touch the dev stack.

### Re-index command
- **What:** rebuild the ChromaDB vectors for the whole library from
  `captions`. Today only a per-video Redo, or a caption edit, re-indexes.
- **Why:** after a restore, or a lost `vectors` volume, search misses every
  video until each one is touched.
- **Notes:** reuse `reindex_captions` per video. Exposed as a `vcm` command or
  a Settings action (not decided).

### Image digest pinning and signing
- **What:**
  - releases record image **digests**, and the compose files pull by digest
    rather than by tag;
  - images are signed (for example with cosign) and verified on install and
    update.
- **Why:** `SHA256SUMS` covers the scripts and compose files but not the
  images, and it is served from the same place as the files it checks
  ([SECURITY.md §8](SECURITY.md#8-installer-checksum-verification-and-its-limits)).

### Right-to-left caption languages: Arabic and Urdu
- **What:** captions in Arabic (`ar`) and Urdu (`ur`). Both are in M2M100's
  language list.
- **Why not yet:** they are written right to left. The preview, the editor's
  text fields and the burn all assume left-to-right lines today: placement,
  alignment, line wrapping and mixed Latin/Arabic runs would each need to be
  bidi-aware and checked in both renderers. Urdu is also normally set in
  Nastaliq, a script style that needs its own font and line height.
- **Must:** a `dir`-aware preview and editor, a burn that matches it
  (libass shapes Arabic, but alignment and `\pos` assume LTR), a bundled font
  per script as for the Indic ones, and the same translation sweep as v1.0.7.

### CJK caption languages: Chinese, Japanese, Korean
- **What:** captions in Chinese (`zh`), Japanese (`ja`) and Korean (`ko`),
  all in M2M100's list.
- **Why not yet:** they need CJK fonts (several MB per script, a large
  update) and different line breaking: Chinese and Japanese have no spaces,
  so the sentence splitter in `translation.split_like` (word boundaries) and
  the caption length limits in the transcriber (characters, not words) would
  both have to change, and the preview's and libass's line breaking would
  have to agree without spaces to break at.

### Re-add Tamil, Marathi, Bengali and Malayalam
- **What:** offer them again, spoken and as captions, with Indian-language
  fine-tuned speech models (e.g. AI4Bharat's IndicWhisper / IndicConformer)
  instead of Whisper large-v3, and a better translator into them.
- **Why not yet:** measured on FLEURS for v1.0.10
  ([LANGUAGE_QUALITY.md](LANGUAGE_QUALITY.md)), large-v3 made 76% word
  error on Marathi, 73% Bengali, 63% Tamil (28% of characters) and wrote
  Malayalam in Gurmukhi, Devanagari or Telugu script (95% of characters
  wrong); turbo on the CPU was worse (82%, 92%, 95%). Detection called
  Marathi Hindi a third of the time. M2M100 into them scored chrF 43
  (Bengali), 38 (Marathi), 34 (Malayalam) and 24 (Tamil), against 55-68
  for the European languages. Removed in v1.0.11.
- **Must:** a model under a permissive licence that downloads on first use
  like Apex (not baked into the image), measured with
  `scripts/language_eval.py` to at least "Usable" (WER 35% or less, CER 20%
  for Tamil and Malayalam) on large-v3's hardware tier and an honest number
  for the CPU, captions in the right script, and the checks in TESTING.md
  "Adding a caption language". The fonts are still bundled.

### Forced alignment of word timings
- **What:** after Whisper, force its own text onto the audio with a CTC
  aligner (a wav2vec2/MMS model) and time captions to those word starts
  instead of Whisper's.
- **Why:** since v1.0.9 the pipeline passes Whisper's word starts through
  to within 0-20 ms, so what is left of the caption-start error is
  Whisper's own word timestamps. Measured for v1.0.9 against forced-aligned
  truth (docs/TESTING.md, "Caption starts against the speech"): 3-4
  captions per clip outside the rule (no later than +100 ms, no earlier than
  −200 ms), up to about +0.15 s late and −0.26 s early, one long Spanish word
  −0.55 s. The same MMS aligner (torchaudio `MMS_FA`), run outside the app,
  is what those measurements use, and it lands within ~0.05 s of the
  waveform where both are clear.
- **Why not yet:** it is a model addition (a download per install, more
  memory, more time per video) and only shaves the last tenths of a second.
  Tanush, 2026-10-20: not now.
- **Must:** measured per hardware tier (time, memory, download) against
  today's numbers; romanisation for scripts the aligner can't read
  (Devanagari and others); the v1.0.8 timing rules still hold.

## Possible, not planned
- **More caption languages.** Nine are offered (v1.0.11). Telugu is not in
  M2M100; Kannada, Gujarati and Punjabi came out of it unusable (samples in
  PROGRESS.md, v1.0.7). Any of them needs a different local model, which is a
  model change, not a list entry. A new language is admitted only after the
  checks in TESTING.md §4 "Adding a caption language".
- **Hosted (accounts) mode.** The code is kept and tested (`AUTH_MODE=accounts`
  with `NEXT_PUBLIC_AUTH_MODE=accounts`), but it is not an active direction and
  is not shipped. See [DECISIONS.md D2](DECISIONS.md#d2-local-mode-without-login).
- **macOS testing.** macOS stays "untested" until a Mac is available.
- **Prettier.** Not now: adopting it would reformat the whole frontend in one
  change.
