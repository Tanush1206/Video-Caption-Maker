# AGENTS.md

Instructions for AI coding agents (and humans) working in this repository.

## Project context

VideoCaptionMaker captions videos **on the user's own computer**. The flow is
upload → choose a caption language → (optionally) edit and style → export an
MP4 with burned-in captions, or SRT/VTT/JSON.

- **Speech:** Whisper via faster-whisper.
- **Translation:** M2M100 via CTranslate2, both local. Gemini is optional
  (with a key in Settings).
- **Install:** one command, Docker Compose underneath, single-user local mode
  with **no login**, UI only on `127.0.0.1`.
- **Stack:**
  - Next.js 14 (`frontend/`);
  - FastAPI + Celery (`backend/`, one image, `api`/`worker` commands);
  - Postgres 16, Redis 7, ChromaDB 1.0;
  - installers in `install/`, release automation in `.github/workflows/`.
- **Current release:** v1.0.6 (2026-10-15). Progress, decisions and the
  backlog are in
  [PROGRESS.md](PROGRESS.md); later work is in [docs/ROADMAP.md](docs/ROADMAP.md).

## Source of truth: `docs/`

The docs describe the code as it is. **Read the relevant ones before changing
anything.**

| Doc | Read before touching |
|---|---|
| [docs/PRD.md](docs/PRD.md) | features, flows, acceptance criteria, limitations, definition of done |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | services, pipeline, hardware tiers, translation, recovery, compose, dependency rules |
| [docs/DATABASE.md](docs/DATABASE.md) | models, migrations, storage layout |
| [docs/API.md](docs/API.md) | routes, schemas, errors |
| [docs/SECURITY.md](docs/SECURITY.md) | request guard, audit log, secrets, uploads, installers |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | any env var or `.env` |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | any UI |
| [docs/CODE_STYLE.md](docs/CODE_STYLE.md) | any code; commit format |
| [docs/TESTING.md](docs/TESTING.md) | tests, E2E, release checklist |
| [docs/DECISIONS.md](docs/DECISIONS.md) | anything that revisits a past decision |
| [docs/ROADMAP.md](docs/ROADMAP.md) | anything already planned for later (don't build it unasked) |
| [CHANGELOG.md](CHANGELOG.md) | release notes |

## Rules

### Before changing code
1. **Read the relevant docs first** (table above), then the code they point
   to.
2. **Plan before any non-trivial change.** Write down the files to touch, the
   approach and how you'll verify it, before editing.
3. **When docs and code conflict, ask. Don't guess.** Don't silently "fix"
   either side; report the mismatch and wait for an answer. The same applies
   to anything listed under a doc's "Open questions".
4. **No invented requirements.** Implement what was asked. Don't add
   features, settings or UI that nobody requested, and **never show mock
   data**: every figure in the UI comes from the API.

### While changing code
5. **Prefer minimal changes to rewrites.** Fix the thing, match the
   surrounding code's style (docs/CODE_STYLE.md), and don't reformat or
   rename unrelated code.
6. **Keep the dependency rules** (docs/ARCHITECTURE.md §11):
   - thin routers, logic in `services/`;
   - 404 (not 403) for someone else's resource;
   - no ML imports at module level in the API;
   - option lists are served by the API.
7. **UI work restyles without changing logic**, uses the `ui/` primitives and
   tokens, and must keep axe-core at 0 violations.

### Secrets and private files
8. **Never read, print or log the values in a `.env`** (repo root, an
   install's folder, or anywhere else). Refer to variables by name only.
9. **Never commit secrets**: `.env`, certificates (`certs/`, `*.crt`,
   `*.pem`), `backend/storage/`, `*.dump`, or anything with a key in it.
   - Keep them out of images: the backend builds from an allow-list.
   - Keep them out of release assets.
10. **Keep `design/stitch/` out of git.** It is gitignored, and so is
    `learning-guide.md`. Never stage or copy either into a tracked file.

### Verify before committing
11. **Run tests, lint and build before committing:**
    - backend: `docker compose exec backend ruff check app tests alembic scripts`
      and `docker compose exec backend python -m pytest`. The suite uses its
      own `_test` database, Redis db 14, collection and temp storage; **never**
      point tests at real data;
    - frontend: `npm run lint`, `npm run type-check` and `npm test`;
    - UI changes: `scripts/ui-check` (`shoot.js`, `axe.js`, and the relevant
      `checks.js` checks; axe must report 0);
    - build: `docker build --target build frontend`, or let CI run it;
    - **never** run `next build` inside the running dev container: it
      clobbers `.next`.
    
    For pipeline or installer changes, also run `scripts/e2e.py` against a
    running install (docs/TESTING.md).
12. **Update the affected docs and PROGRESS.md** in the same piece of work:
    - a new env var → ENVIRONMENT.md;
    - a new route → API.md;
    - a migration → DATABASE.md;
    - and so on.

### Git
13. **Commit in small groups** (about 5 files at most, one fix or one screen
    per commit), in Conventional Commits format (`type(scope): summary`).
14. **No `Co-Authored-By` trailers** (or any other attribution trailer) in
    commit messages.
15. **Never push and never tag.** The maintainer does both. When a push or
    tag is needed, give the exact command and wait for confirmation.

### Docker on a shared host
16. **No host-wide cleanup.** Never run `docker system prune` or
    `docker volume prune`. Delete only the test resources you created, by
    name.
17. **Never touch the dev stack from install tests.** The dev stack is
    compose project `videocaptionmaker` (`vcm_*` container names,
    `videocaptionmaker_*` volumes); the install is project `vcm`. Test the
    `DELETE` uninstall only on a disposable clean machine.
18. **The install and the dev stack both use port 3000.** Run `vcm stop`
    before `docker compose up`.
    - **Ask before taking port 3000.** Before switching it from the
      installed app to the dev stack, tell the maintainer and wait for an
      OK. An open browser tab on `localhost:3000` talks to whichever stack
      holds the port, so without warning an upload meant for the installed
      app lands in the dev stack (it happened during the v1.0.7 release).
    - **Say when it's back.** Run `vcm start` as soon as the dev work is
      done, and tell the maintainer the installed app is back on port 3000.
19. **Give time estimates for long operations** (image pulls, model
    downloads, E2E runs) instead of waiting silently.

### Test data
20. **Every test run deletes the videos it created when it finishes**, in the
    dev stack and in the installed app alike: E2E runs (`scripts/e2e.py`),
    ui-check runs, uploads made by hand to try something, and the copies a
    run makes along the way.
    - Note each video's id as you create it, and delete exactly those ids;
      never pick videos to delete by name or date alone.
    - Delete through the API (`DELETE /api/videos/{id}`), never in the
      database or on disk, so the video's files, captions and exports go
      too.
    - Never delete a video you did not create. If you can't tell whether
      you did, leave it and ask.
    - Report that you did it: how many, which ids, and the count that
      remains.

## Quick commands

```bash
# dev stack
cp .env.example .env                 # never commit it
docker compose up -d                 # CPU; GPU: VCM_VARIANT=cuda … -f docker-compose.gpu.yml up -d --build
docker compose exec backend alembic upgrade head   # dev migrations are manual
docker compose exec backend ruff check app tests alembic scripts
docker compose exec backend python -m pytest
docker compose exec frontend npm run lint
docker compose exec frontend npm run type-check
docker compose exec frontend npm test

# end to end against a running install
python scripts/e2e.py --base http://localhost:3000 --video clip.mp4
```
