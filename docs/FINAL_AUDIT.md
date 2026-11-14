# Final deployment audit

Audit of the released **v1.4.0** (tag on `3f4faef`, published 2026-11-12) as
a new user would meet it: the install, the core flows, security, legal,
quality, the docs and the release itself. Started 2026-11-13, item 3 of the
finishing plan in [PROGRESS.md](../PROGRESS.md). It follows up every finding
of the [launch audit](LAUNCH_AUDIT.md) of v1.1.0.

**Scope of fixes:** blockers and clear bugs only, released as v1.4.1.
Everything else is listed with a recommendation and goes to the
[ROADMAP](ROADMAP.md) or to Tanush for a decision.

**Severity:** as in the launch audit.
- **High:** fix before calling the project finished.
- **Medium:** a real gap with limited impact or reach.
- **Low:** hygiene and polish.

**What was checked, and with what:**
- the released images:
  - `backend:1.4.0-cuda` (`313f3ed5…`);
  - `backend:1.4.0-cpu` (`de522d47…`, amd64 + arm64);
  - `frontend:1.4.0` (`54513867…`, amd64 + arm64);
- the install on this machine, updated from 1.3.1 (RTX 5080, Windows 11,
  Docker Desktop 29.9);
- a clean Linux machine: a nested Docker with no images (`vcm-clean`),
  installed with the README's command, unchanged;
- the live site and the GitHub repository, read without signing in.

**Tools:** Trivy 0.76.1, gitleaks 8.30.1, npm audit, Lighthouse 12.8.2,
Playwright with axe-core, `scripts/e2e.py`, `scripts/ui-check`. The scanners
ran from their Docker images. Outputs are in
`test-assets/results/v1.4.0/audit/` and `…/release/` (not in git).

**Not covered here:** macOS. Tanush tests v1.4.0 on an M2 MacBook Air; its
rows in §2.3 are open.

## Summary

**No blocker was found.** v1.4.0 installs, updates, captions and exports as
documented, on the GPU and on the CPU, on the updated install and on a
clean machine. Nine findings are clear, small bugs or stale docs, fixed for
v1.4.1. Four needed a decision from Tanush, made on 14 Nov: three are done
in v1.4.1 and one is on the ROADMAP.

| ID | Area | Severity | Finding | Outcome |
|---|---|---|---|---|
| F1 | Install | Low | `vcm doctor`'s first lines say `VCM_VERSION=latest`, not the version running | fixed for v1.4.1 (`13b58d9`) |
| F2 | Install | Low | The installer and `vcm update` give up at once on "server gave HTTP response to HTTPS client", a passing network fault | fixed for v1.4.1 (`ea929d6`) |
| F3 | Install | Low | On Windows, a clear installer stop is followed by a red PowerShell error block (launch audit U4, still open) | fixed for v1.4.1 (`302473e`) |
| F4 | Quality | Low | The app has no favicon: a 404 and a console error on every page (launch audit P4, still open) | fixed for v1.4.1 (`35499df`) |
| F5 | Docs | Low | AGENTS.md names v1.0.6 as the current release | fixed (`f0cf359`) |
| F6 | Docs | Low | `VCM_PULL_WAIT` is not in ENVIRONMENT.md | fixed (`f0cf359`) |
| F7 | Docs | Low | TESTING.md still counts 351 backend tests (v1.0.5); there are 775 | fixed (`f0cf359`) |
| F8 | Release | Low | A GitHub Release's notes are only a compare link; the CHANGELOG text is not on the Releases page | fixed for v1.4.1 (`5573c3b`) |
| F9 | Release | Low | Open launch-audit items on no list (S6, M1's mirror) | on the ROADMAP (`f0cf359`) |
| F10 | Install | Low | After a keep-data uninstall, a reinstall and a `DELETE` uninstall, one empty unnamed volume remains | on the ROADMAP (Tanush, 14 Nov) |
| D1 | Security | Medium | Patch level (launch audit S6, never done): 73 fixable critical/high OS advisories and 23 in Python packages, none found reachable | done in v1.4.1, scoped (Tanush, 14 Nov): 0 fixable critical or high left in Debian packages, 7 high in Python packages that need a major version |
| D2 | Security | Medium | The frontend runs on Node 20, end of life since April 2026; 4 high npm advisories with fixes | done in v1.4.1 (`7dd0fc0`): Node 22, `npm audit fix` |
| D3 | Quality | Low | Editor: 0.15 layout shift on a phone, a 16 px tall time button, one label that differs from its name | fixed in v1.4.1 (`5a72dba`, `17decf5`) |
| T1 | Release | Medium | The weekly check has never run (0 runs); its first schedule is Monday 16 Nov | run by hand on 14 Nov (Tanush): green |
| T2 | Release | Low | The repository has no topics; the GitHub settings of the launch audit §1.12 can't be read from outside | done (Tanush, 14 Nov): topics added, settings checked |

## 1. The launch audit, finding by finding

| ID | Launch finding | State at v1.4.0 |
|---|---|---|
| S1 | Next.js 14 out of support | **Fixed** (v1.1.1 image optimiser off, v1.2.0 Next 15.5.28) |
| S2 | FFmpeg crafted-file CVEs | **Mitigated** (v1.1.1 allow-lists). Debian's FFmpeg still has 17 high CVEs with no fix (16 then) |
| S3 | Backend and worker ran as root | **Fixed** (v1.1.1). On the install: uid 10001, `CapEff 0`, `NoNewPrivs 1` |
| S4 | No security headers, frameable | **Fixed** (v1.1.1). CSP, `X-Frame-Options: DENY`, nosniff, Referrer-Policy and Permissions-Policy served; `checks.js framing` passes |
| S5 | emSign roots trusted | **Fixed** (v1.1.1) |
| S6 | Patch level depends on releases | Patched in v1.4.1 (D1); the scan that stops a release is on the ROADMAP |
| S7 | Actions pinned to tags, wide permissions | **Fixed** (v1.1.1 SHAs; v1.4.0 least privilege, Dependabot) |
| S8 | Criticals that don't apply here | Unchanged, still not reachable (python-jose, chromadb client, ecdsa, npm's own tar and minimatch) |
| S9 | Service images behind on patches | Unchanged: Postgres 16.14 and Redis 7.4.10 pinned, ChromaDB 1.0.0; internal network only. Not rescanned |
| S10 | Upload handling | Sound, as then; uploads are streamed since v1.2.0 |
| S11 | Secrets in git history | **Clean again**: 554 commits, 6 hits, all false positives (the 4 from then, and the dummy key in the two `vcm doctor` tests) |
| P1 | Layout shift, dashboard and settings | **Fixed** (v1.4.0): 0.000 in Lighthouse and in `checks.js cls` |
| P2 | 60 minutes: 15 at "99%", slow phrasing, long caption list | **Partly fixed** (v1.4.0): stages of their own, phrasing 4.6x faster. List virtualisation and capping run length are on the ROADMAP |
| P3 | First search 20 s, calls Hugging Face | **Improved** (v1.1.1): offline, 5.3 s cold, 28 ms warm |
| P4 | No favicon | **Open**: F4 |
| P5 | Site images larger than shown | Unchanged: Lighthouse still estimates 216 KiB to save; the site scores 94-98 |
| P6 | `localhost` slow for scripts on Windows | Unchanged, by design (scripts use 127.0.0.1) |
| SEO1 | No link preview | **Fixed** (v1.1.1): `og.png` served |
| SEO2 | Canonical, icons, sitemap, JSON-LD | **Fixed** (v1.1.1) |
| SEO3 | robots.txt needs a root repo | Open by choice (Tanush); the site's SEO score stays 92 |
| SEO4 | Analytics | As then |
| U1 | First run clear; "99%" for 15 minutes | **Fixed** (v1.4.0 for the 99%) |
| U2 | Developer text in errors | **Fixed** (v1.1.1) |
| U3 | Cleanup touched other projects | **Fixed** (v1.1.1): only a label-filtered image prune remains |
| U4 | Stack trace after an installer stop | **Open**: F3 |
| L1 | No third-party notices, GPL source offer | **Fixed** (v1.1.1). No dependency or base image has changed since the notices were made (2026-10-28) |
| L2 | No privacy statement | **Fixed** (v1.1.1) |
| L3 | Gemini's terms not passed on | **Fixed** (v1.1.1) |
| L4 | Warranty and rights | **Fixed** (v1.1.1) |
| L5 | India's DPDP Act | Information, unchanged |
| M1 | Model availability | **Partly**: MiniLM pinned (v1.1.1), the weekly check asks Hugging Face for every model (v1.4.0). Whisper repos unpinned and no mirror: F9 |
| M2 | Nothing checks a release still installs | **Built** (v1.4.0), never run: T1 |
| M3 | Backup and restore by hand | ROADMAP |
| M4 | No issue templates, no diagnostics | **Fixed** (v1.4.0), and F1 |
| M5 | No uptime monitor for the site | Tanush; the weekly check also fetches the site |

## 2. Install

### 2.1 Update of an existing install (Windows, GPU)

Done at the release (PROGRESS.md, v1.4.0):
- backup first, then `vcm update` in 26 s on the first try;
- 0.2 MB of backend layers and 11.0 MB of frontend layers downloaded;
- the same videos, caption checksum, exports and media files after it;
- no migration.

### 2.2 A new install on a clean Linux machine (CPU)

A nested Docker with no images, the README's Linux command unchanged, the
real release:

| Step | Result |
|---|---|
| Installer, first run | checks pass, files match `SHA256SUMS`, secrets generated; stopped after 8 s at the image download on one bad answer from Docker Hub (F2). It said to run it again |
| Image download inside the nested Docker | too slow to finish (about 75 MB a layer in 90 minutes), a limit of this test machine seen before (PROGRESS.md, v1.0.2); the host pulled the same CPU backend in 118 s. The released images were loaded in from the host, by digest (`de522d47…`, `54513867…`) |
| Installer again | verified every image against the registry and started the app: 28 s |
| What a new user has | version 1.4.0; `large-v3-turbo` on the CPU chosen by itself; only `127.0.0.1:3000` published; backend and worker uid 10001, frontend uid 100, no capabilities; `.env` readable by its owner only |
| First video (English), then Hindi as spoken and into English | captioned and exported as SRT, VTT and burned MP4: all passed; the speech model downloaded on the first one (167 s in all) |
| `vcm doctor` | report written; no file name or home folder in it. Its first lines say `VCM_VERSION=latest` (F1) |
| `vcm update` (the first real hand-over: this install has 1.4.0's `vcm`) | nothing to download, 7 s, no `*.tmp` left, healthy |
| `vcm uninstall`, keeping the data | containers gone; the five `vcm_*` volumes, the install folder and its `.env` kept; the app's images and the `vcm` link removed |
| Installer again | "Kept existing settings and secrets"; the kept video and its 8 captions are back |
| `vcm uninstall`, `DELETE` | no container, no `vcm_*` volume, no network, no app image, no install folder, no link; Postgres, Redis and ChromaDB images still there. One unnamed volume left (F10) |

The three test videos were deleted through the API before the uninstalls;
the machine, the scanners' images and the pulled CPU image were removed by
name afterwards.

### 2.3 macOS (Apple silicon): open, for Tanush's M2 MacBook Air

| Check | Result |
|---|---|
| The README's macOS command installs with no emulation note and no Rosetta question | |
| `docker exec vcm-backend-1 uname -m` says `aarch64` (and the worker and frontend) | |
| A short video is captioned and exported (SRT and MP4) | |
| Time for a 4-minute video, against the amd64 CPU figures | |
| `vcm doctor` writes its report; the version line is right | |
| `docker exec vcm-backend-1 ls /licenses` lists the notices (the ARM image) | |
| If the Mac had v1.3.1 or older: `vcm update` downloads the images in full once, then runs natively | |
| `vcm uninstall`, keeping the data | |

### F1 · Low · `vcm doctor` didn't say which version was running

**Evidence:** on the install, the report began `VCM_VERSION=latest` (what
the `.env` holds); the real version, 1.4.0, was only under `/api/system`,
and the bug form pointed at the first lines.

**Fix (done, `13b58d9`):** the second line is "Version: 1.4.0
(VCM_VERSION=latest in .env)", from `/api/system`, or from the backend
image's version label, saying so, when the app isn't answering. Bash and
PowerShell, tested in both.

### F2 · Low · One network fault is not retried

**Evidence:** the first run of the installer on the clean machine stopped
after 8 s:
```
failed to do request: Head "https://registry-1.docker.io/v2/chromadb/chroma/manifests/1.0.0":
http: server gave HTTP response to HTTPS client
```
Seconds later the same registry answered normally and the second run went
through. `vcm pull` retries TLS and dropped-connection errors three times
(v1.3.1), but not this one, so the user gets "Couldn't download the images.
Run the installer again; it resumes." That advice is right, and the retry
would have saved the step.

**Fix:** add this error to the ones tried again, with a test in
`install/tests/test_vcm_pull.*`.

**Fixed (`ea929d6`).**

### F3 · Low · A red error block after a clear message (Windows)

**Evidence:** `install.ps1`'s `Fail` prints the message and next step, then
`throw`s, and PowerShell adds its own red block under it (launch audit U4).
The script can't `exit`: under `irm … | iex` that would close the user's
window.

**Fixed (`302473e`):** the installer's own stop is caught at the top level
and ends quietly; any other error still shows. Run as a file it exits 1;
through `iex` the window stays open. `install/tests/test_install_stop.ps1`.

### F10 · Low · One empty, unnamed volume can outlive a `DELETE` uninstall

**Evidence:** uninstall keeping the data, install again, then uninstall
with `DELETE`: one unnamed volume remains. It is Redis's `/data`, which the
Redis image declares and which holds nothing (Redis runs without
persistence). The keep-data uninstall removes the containers but not their
unnamed volumes, and the later `DELETE` only removes those of the
containers it is removing. A single `DELETE` uninstall leaves nothing.

**Options:** remove Redis with its volume in the keep-data path
(`compose rm -sfv redis`, in `vcm` and `vcm.ps1`); or mount `/data` as
`tmpfs` in the compose file, which recreates Redis on everyone's next
update. The PowerShell uninstall can't be run in a test without touching
the machine's own PATH setting.

**Recommendation:** ROADMAP. A few kilobytes, after uninstalling twice.

**Decided (Tanush, 14 Nov):** ROADMAP.

## 3. Core flows

On the updated install, through the browser's address (so the request guard
is in the path):

| Flow | How | Result |
|---|---|---|
| Upload, caption, export SRT, VTT and burned MP4, in Hinglish, English, Hindi and French | `scripts/e2e.py` | all passed; the new stages appear in order |
| The same on the CPU (dev worker without the GPU, 4 cores) | `scripts/e2e.py` | all passed |
| Delete, settings change and back, export and download, at `localhost` and `127.0.0.1` | `flow.js` | passed at both |
| Redo with another spelling, custom vocabulary, export while Improve runs, Improve with Gemini and undo, export quality and time left, the caption-accuracy note | `checks.js`, 13 checks | 165 passed at each address; one Gemini call failed once ("couldn't be reached") and passed on a retry |
| Pipeline shows "Checking for missed speech" and "Arranging captions" with their own percentages | `checks.js pipeline-stages` | passed |
| A 60-minute video's progress | measured, every value logged | no stall over 29 s; phrasing 85 s (390 s before) |

Gemini answered "busy" or timed out several times during these days; each
time the app fell back to local translation with a notice, as designed.
Translation asking Flash-Lite first is on the ROADMAP.

## 4. Security

| Check | Result |
|---|---|
| Request guard, both addresses | a POST from another origin, another localhost port, cross-site, or with a rebinding Host: 403; the app's own origin passes |
| Headers | CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`, Permissions-Policy on pages; `nosniff` on the API |
| Containers | uid 10001 (backend, worker) and 100 (frontend), no capabilities, `no-new-privileges` |
| Ports | only `127.0.0.1:3000` is published |
| Secrets | none in the images (only CA bundles), the release assets, the tracked files or 554 commits of history |
| `vcm doctor` report from the real install | no key, token, email address, file name, home folder or 64-hex secret |
| Workflows | least privilege, actions pinned to commits, standard runners, one schedule |
| Update | files checked against `SHA256SUMS` before anything runs or is replaced |

### D1 · Medium · Patch level (launch audit S6) — done in v1.4.1

**Evidence (Trivy, `backend:1.4.0-cuda`, Debian 13.6):**

| | Critical | High | With a fix: critical | With a fix: high |
|---|---|---|---|---|
| Debian packages | 5 | 354 | 4 | 69 |
| Python packages | 5 | 24 | 2 | 21 |
| Frontend, Alpine 3.23.4 | 0 | 7 | 0 | 7 |

The launch audit counted 8 critical and 290 high in Debian packages. The
image's base layers are cached from release to release, which is what keeps
updates small, so its packages are as old as the last base rebuild.

Going through the fixable ones against the launch audit's reachability
table, nothing new is reachable:
- **perl, util-linux, mount, login, apt:** nothing in the app runs them;
- **curl:** the healthcheck to 127.0.0.1 only;
- **libexpat, sqlite, pcre2, zlib, brotli, openssl:** low, as then;
- **FFmpeg:** 17 high, none with a fix; the v1.1.1 allow-lists stand;
- **Authlib** (1 critical, 3 high, new): installed but never imported
  (Google sign-in is written with httpx), so it can simply be removed;
- **npm's own packages in the frontend image** (tar, minimatch, glob and
  others; 1 critical, 25 high): npm is not run in the installed app
  (launch audit S8);
- **certifi:** flagged by version; its bundle is the system's, without
  emSign, since v1.1.1;
- **aiohttp, urllib3, pyasn1, filelock, python-jose, chromadb, ecdsa:** as
  in the launch audit.

**Options:**
1. **A maintenance release after the project closes** (recommended):
   `apt-get upgrade` in the runtime stage, bump the Python constraints,
   drop pip, setuptools and wheel from the runtime, add a Trivy step to
   `release.yml` that fails on a fixable critical or high. Every user
   downloads the backend in full once (0.8 GB CPU, 2.3 GB CUDA), and the GPU
   stack needs a full regression. On the ROADMAP now (F9).
2. **In v1.4.1:** the same work now. It turns a 10 MB bug-fix update into a
   2.3 GB one, days before the close.
3. **Accept as is.**

**Decided (Tanush, 14 Nov): in v1.4.1, scoped.** All fixable Debian
packages; Python packages only where the fix is a patch or minor version
and the package is not ML core (torch, CTranslate2, faster-whisper,
transformers and what they need). Then: python-jose replaced if the swap is
small.

**Done:**
- `a64a57b`: the base image is `python:3.11.18-slim-trixie` and the runtime
  stage runs `apt-get upgrade` (`APT_REFRESH` rebuilds that layer). Moved
  to their fixed versions: Authlib, Mako, aiohttp (with yarl and multidict),
  certifi, dnspython, joserfc, pyasn1, urllib3 and the opentelemetry
  packages.
- `e0a43d6`: opentelemetry 1.45.2, released after the first pass and found
  by the rescan.
- `ba771e2`: **python-jose is replaced with PyJWT 2.15.1.** The app used it
  in one file (`utils/security.py`) for HS256 tokens only. ecdsa and rsa,
  installed only for it, are gone. Tokens are the same, so one issued
  before the update is still accepted
  (`tests/test_security_tokens.py`, 13 tests).
- The speech and translation stack is unchanged: torch 2.13.0, CTranslate2
  4.8.1, faster-whisper 1.2.1.

**After (Trivy 0.76.1, the images built from `2ff7ca7`; the CUDA and CPU
backends scan the same):**

| | Critical | High | With a fix: critical | With a fix: high |
|---|---|---|---|---|
| Debian packages (13.7) | 1 | 285 | 0 | 0 |
| Python packages | 2 | 9 | 0 | 7 |
| Frontend, Alpine 3.24.4 | 0 | 0 | 0 | 0 |
| Frontend, npm packages | 0 | 12 | 0 | 12 |

The frontend's 12: 10 in npm's own packages, which the installed app never
runs (launch audit S8), and 2 for the postcss inside Next (D2).

**What is left in Python packages, and why none is reachable:**

| Package | Advisories | Fix | Why it stays | Why it isn't reachable |
|---|---|---|---|---|
| chromadb 1.5.9 | 2 critical, 2 high: code injection before sign-in, and missing authorization checks | none exists | no fixed version | all four are in the ChromaDB **server**. The backend only uses the client (`chromadb.HttpClient`, `services/embeddings.py`). The server is its own container, reachable only inside the compose network, with no published port |
| filelock 3.32.2 | 1 high (a lock's database file reopened unsafely), 9 medium | 4.2.1 | a major version, and an ML-core dependency (torch, huggingface_hub) | it locks files in the model cache while a model downloads. Exploiting it needs another local user writing in that folder; the container has one user and the cache is the app's own volume |
| oauthlib 3.3.1 | 2 high (OAuth **server** grant handling, device-code check), 2 medium | 4.0.1 | a major version | never imported. It arrives through chromadb → kubernetes → requests-oauthlib; the app runs no OAuth server and no Kubernetes client |
| wheel 0.45.1 | 1 high (unpacking a malicious wheel file) | 0.46.2 | it is the copy inside setuptools 79, not a package of its own; the fix is setuptools 83, a major version, and setuptools is a CTranslate2 and torch dependency | only runs when a package is installed or built. Nothing is installed in a running install |
| jaraco.context 5.3.0 | 1 high (path traversal in a malicious tar archive) | 6.1.0 | the same: inside setuptools | the same |
| pip 24.0, setuptools 79.0.1 | medium only | pip 26, setuptools 83 | major versions | not run in the installed app |

wheel and jaraco.context are each counted twice by the scanner (the
system Python's setuptools and the app's), which makes the 7.

**The one critical left in Debian packages** is libxml2 (a use-after-free
on crafted XML), with no fix in Debian 13 yet. FFmpeg reads XML only in
its DASH demuxer, which the v1.1.1 format allow-list removes (launch audit
S6).

**Still on the ROADMAP:** the Trivy step that stops a release, the major
versions above, removing Authlib (installed, never imported), and dropping
pip and setuptools from the runtime where CTranslate2 allows it.

### D2 · Medium · Node 20 is past end of life — done in v1.4.1

**Evidence:** the frontend image and CI use `node:20.20.2-alpine`; Node 20
reached end of life in April 2026 and gets no security fixes. `npm audit`
(production dependencies): 4 high, 1 moderate, all with fixes (zod, nanoid,
source-map-js, and postcss inside Next). The launch audit found zod and
postcss unreachable here; the frontend listens on 127.0.0.1 only, behind its
own guard.

**Options:**
1. **In v1.4.1** (recommended): Node 22 LTS for the image and CI, `npm
   audit fix`, notices regenerated. The frontend image is small (about
   60 MB in full), so the update stays small. Needs the frontend suite, the
   production build, the UI checks and one E2E.
2. **With D1's maintenance release.**

**Decided (Tanush, 14 Nov): in v1.4.1. Done (`7dd0fc0`):** the image and
CI use `node:22.23.5-alpine`; `npm audit fix` moved Next to 15.5.29, nanoid
and source-map-js to their fixed versions. Left: zod (the fix is v4) and
the postcss inside Next (the fix is Next 16), both found unreachable at the
launch audit, both on the ROADMAP.

### Not changed, noted

- `Cache-Control: s-maxage=31536000` on pages is Next's default for static
  pages; with no shared cache in front of a local app it has no effect.
- The API answers with `server: uvicorn`. Harmless on 127.0.0.1.

## 5. Legal

| Check | Result |
|---|---|
| `THIRD_PARTY_NOTICES.md` | current: no dependency, model, font or base image change since it was generated (2026-10-28) |
| `/licenses` in the images | backend: `THIRD_PARTY_NOTICES.md`, `LICENSE`, `SOURCES-debian.txt`, fonts, Python; frontend: the same with `SOURCES-alpine.txt`, node, npm (amd64, on the install). The ARM images are a row in §2.3 |
| Licence | MIT, detected by GitHub |
| Privacy | `PRIVACY.md` and the site's privacy page, both live |
| Gemini's terms | in Settings and the README since v1.1.1 |
| Models | all MIT or Apache-2.0, as in PRD §9 |

Nothing new. The launch audit's note stands: this is not legal advice.

## 6. Quality

### 6.1 Lighthouse 12.8.2 (the install on port 3000; the live site)

| Page | Device | Perf | A11y | Best pr. | SEO | LCP | CLS |
|---|---|---|---|---|---|---|---|
| Dashboard | desktop | 98 | 100 | 96 | 100 | 1.1 s | 0.000 |
| Dashboard | mobile | 80 | 100 | 96 | 100 | 5.6 s | 0.000 |
| Editor (video 84) | desktop | 94 | 96 | 96 | 100 | 1.5 s | 0.078 |
| Editor (video 84) | mobile | 69 | 100 | 93 | 100 | 7.5 s | 0.150 |
| Settings | desktop | 99 | 100 | 96 | 100 | 1.0 s | 0.000 |
| Settings | mobile | 80 | 100 | 96 | 100 | 5.4 s | 0.000 |
| Search | desktop | 99 | 100 | 96 | 100 | 1.0 s | 0.004 |
| Search | mobile | 82 | 100 | 96 | 100 | 5.0 s | 0.014 |
| Site | desktop | 94 | 100 | 100 | 92 | 1.4 s | 0.000 |
| Site | mobile | 98 | 100 | 100 | 92 | 2.3 s | 0.000 |
| Site, privacy page | mobile | 98 | 100 | 100 | 92 | 2.4 s | 0.000 |

Against the launch audit: the dashboard on a phone went from 62 to 80 and
settings on a desktop from 81 to 99, both from the layout-shift fix (0.438
and 0.371 then). The mobile runs simulate slow 4G and a 4x slower processor,
which overstates load times for an app served by the same computer. These
are lab numbers; a local app has no field data.

**What still fails an audit:**
- Best practices 96 on every app page: the favicon 404 (F4);
- the editor (D3);
- the site's SEO 92: robots.txt (SEO3, open by choice).

### 6.2 Accessibility, errors, speed

| Check | Result |
|---|---|
| axe (WCAG 2 A/AA), light and dark | 0 violations: dashboard, search, settings and the editor on the install; both pages of the site |
| Console errors, overflow | none at 375 and 1440 px, light and dark (app and site), except the favicon 404 |
| API, 10 warm requests each | 8-31 ms median; export options 67 ms (it runs ffprobe); search 28 ms warm, 5.3 s the first time |
| First-load JavaScript | dashboard 146 kB, editor 172 kB, settings 134 kB, search 134 kB (174, 196, 158 and 164 kB at the launch audit) |
| Site | live pages equal the repository; 36 outside links in the README, site and policies all answer |

### F4 · Low · No favicon in the app

**Evidence:** `GET /favicon.ico` is 404 on every page, and the browser logs
an error (launch audit P4). The site has `favicon.svg`.

**Fixed (`35499df`):** the app serves the same icon (`app/icon.svg`);
`checks.js favicon`.

### D3 · Low · The editor's remaining audit failures — fixed in v1.4.1

**Evidence (Lighthouse, video 84):**
- on a phone, 0.150 of layout shift while the editor loads (`<main>`
  moves), over the 0.1 "good" line; 0.078 on a desktop. v1.4.0's fix covered
  the dashboard and settings, as planned;
- the caption list's time button is 16 px tall, and four row buttons leave
  22 px between them, under WCAG 2.2's 24 px target size. The project's
  bar, WCAG 2 A/AA with axe, passes;
- the caption-language button's name ("Caption language: हिन्दी") differs
  from its visible text ("हिन्दी Hindi");
- 11 px labels on a phone.

**Recommendation:** ROADMAP. None blocks use; each changes the editor's
layout and needs the UI checks at both widths.

**Decided (Tanush, 14 Nov): fix the first three in v1.4.1.**
- **Layout shift (`5a72dba`).** The cause: while the captions were still
  loading, the editor showed "No speech was found in this video" above the
  workspace and took it away when they arrived, which moved everything
  below. It now says so only when the captions have come back empty. Every
  API answer 600 ms late: 0.157 → 0.005 on a phone, 0.085 → 0.014 on a
  desktop (`checks.js editor-cls`, under 0.1).
- **Targets (`17decf5`).** The time button is 24 px tall and the row's
  tools are no longer covered by the text below; the row keeps its height.
  axe's `target-size` finds nothing in the editor.
- **The name (`17decf5`).** The language buttons are named by what they
  show: "Caption language: हिन्दी Hindi". axe's
  `label-content-name-mismatch` finds nothing
  (`checks.js editor-targets`).
- The 11 px labels on a phone are unchanged.

## 7. Docs

| Doc | Against | Result |
|---|---|---|
| API.md | the API's own route list | 53 of 53 routes, none extra |
| DATABASE.md | Alembic | 24 migrations, head `f6b1d8e3a925` in both |
| ENVIRONMENT.md | settings, `.env.example`, compose files, installers | all there but `VCM_PULL_WAIT` (F6) |
| README, site | v1.4.0 | commands, native ARM note and troubleshooting are current; `vcm doctor` added |
| CHANGELOG | tags | an entry for every release |
| AGENTS.md | the release | names v1.0.6 (F5) |
| TESTING.md | the suite | counts 351 tests (F7) |
| PRD.md | history | "no one has run it on a Mac" corrected on 12 Nov |

**F5, F6, F7:** corrected (`f0cf359`).

## 8. Release hygiene

| Check | Result |
|---|---|
| Tags and releases | 20 tags, 20 releases, none a draft or pre-release; v1.4.0 is the latest |
| Assets | 8, matching `SHA256SUMS` and the tag (the two `.ps1` by line endings only) |
| Images | `latest` = `1.4.0`; CPU backend and frontend amd64 + arm64, CUDA amd64; all read anonymously |
| CI | `ci` and `arm64` green on `main` (`f9397e7`); `release` green on the tag, 8 jobs |
| Commits | no secret, no attribution trailer |
| Repository | public, MIT, issues on with the two forms, security reports to private advisories |
| Schedules | one: the weekly check |

### F8 · Low · Release notes are only a compare link

**Evidence:** the v1.4.0 Release's text is one line, "Full Changelog: …
compare/v1.3.1...v1.4.0". Someone on the Releases page doesn't see what
changed without opening CHANGELOG.md.

**Fixed (`5573c3b`):** `scripts/release_notes.sh` prints a version's
CHANGELOG section and `release.yml` puts it above the compare link; checked
in CI. v1.4.1's own Release is its first use.

### F9 · Low · Open items on no list

Added to the ROADMAP (`f0cf359`): image patching with a Trivy gate (S6,
D1), and a model mirror with pinned Whisper repositories (M1). After the
decisions of 14 Nov the first became "a scan that stops a release, and the
advisories v1.4.1 left", and F10 has its own entry.

### T1 · Medium · The weekly check has never run

**Evidence:** `weekly-check.yml` has 0 runs. It was merged on 12 Nov and
first fires on Monday 16 Nov, 06:00 UTC. Until it has run once, nothing
shows that its steps work against the real release (the model check runs
inside the released image) or that a failure opens an issue.

**For Tanush:** Actions → weekly-check → Run workflow, once. I'll read the
result.

**Done (14 Nov):** run 43488475910, started by hand, succeeded: all five
steps passed against the released v1.4.0, and the job that opens an issue
was skipped, as it should be when nothing fails. That job has still never
run for real.

### T2 · Low · Settings only the owner can see

- The repository has no topics (they help people find it).
- The launch audit's §1.12 list can't be read from outside: Dependabot
  alerts, secret scanning and push protection, CodeQL, rulesets for `main`
  and `v*` tags, Actions defaults, 2FA.
- GitHub's community profile lists no CONTRIBUTING file or code of conduct.
  Optional for a one-maintainer project.

**Done (Tanush, 14 Nov):** topics added and the security settings checked.

## 9. For v1.4.1

- **In, all done and committed:** F1 to F9, D1 (scoped, with PyJWT in
  place of python-jose), D2, D3.
- **Checked on `2ff7ca7`:** backend 786 passed and 2 skipped, ruff clean;
  frontend lint, types, 10 tests and the production build; installer tests
  in bash and Windows PowerShell 5.1; screenshots at 375 and 1440 px in
  both themes, axe 0 on the dashboard, search, settings and the editor;
  `checks.js`, 176 checks passed; E2E on the GPU (Hindi, English, French,
  with SRT, VTT and MP4) and on the CPU (4 cores): ALL PASSED.
- **On the ROADMAP:** F10, and what D1 and D2 left.
- **Done by Tanush:** T1, T2. **Open:** the macOS rows in §2.3.
- **The update downloads the backend in full once** (0.8 GB CPU, 2.3 GB
  CUDA); the CHANGELOG says so first.
- **Before the tag:** the full release checks on the final commit, and
  1.4.1's date in the CHANGELOG (its Release notes are read from there).

## Test data

Recorded in PROGRESS.md with each run. Videos created for this audit are
deleted through the API by their ids; the install keeps 84, 220 and 221,
and the dev stack 7426.
