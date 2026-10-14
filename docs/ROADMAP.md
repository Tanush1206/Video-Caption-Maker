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

## Possible, not planned
- **More caption languages.** Out of scope for now. The five targets (en, hi,
  fr, de, nl) are the ones that have been checked end to end; M2M100 could
  translate more. Adding one means an entry in `services/languages.py`, plus
  E2E runs for every new pair.
- **Hosted (accounts) mode.** The code is kept and tested (`AUTH_MODE=accounts`
  with `NEXT_PUBLIC_AUTH_MODE=accounts`), but it is not an active direction and
  is not shipped. See [DECISIONS.md D2](DECISIONS.md#d2-local-mode-without-login).
- **macOS testing.** macOS stays "untested" until a Mac is available.
- **Prettier.** Not now: adopting it would reformat the whole frontend in one
  change.
