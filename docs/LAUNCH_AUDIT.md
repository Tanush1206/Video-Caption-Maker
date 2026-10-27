# Launch-readiness audit

Audit of v1.1.0 (the app, its images and installers) and the landing site, on
2026-10-27. **Phase 1: findings only; nothing in the product was changed.**
Each finding has a severity, the evidence, and a proposed fix with a rough
effort. Phase 2 fixes only what is approved.

**Severity:**
- **High:** fix before launch; a real, reachable risk or a legal gap in what
  is distributed.
- **Medium:** fix soon after; a real gap, but limited impact or hard to reach.
- **Low:** worth doing; hygiene, polish or defence in depth.

**How it was checked:**
- the shipped images, digests:
  - `backend:1.1.0-cpu`;
  - `backend:1.1.0-cuda` (`c690687d…`);
  - `frontend:1.1.0` (`73c3d8b5…`);
- the running install on this machine (RTX 5080, Windows 11, Docker Desktop
  29.6);
- the live site.

**Tools:** Trivy 0.76.1, pip-audit 2.10.1, npm audit, gitleaks 8.30.1,
Lighthouse 12.8.2, Playwright and axe. The scanners ran from their Docker
images and nothing was installed on the machine.

**Test data:** test video 105 was created for the scale test (P2), and test
video 106 for the first-run walk-through (U1). Both were deleted through the
API (`DELETE /api/videos/{id}`, 204 each). Only video 84 remains, which
predates the audit.

## Summary

| ID | Area | Severity | Finding |
|---|---|---|---|
| S1 | Security | **High** | Next.js 14.2.35 is out of support: 3 critical and 9 high advisories with no 14.x fix |
| S2 | Security | **High** | FFmpeg 7.1.5 (Debian) has 16 high CVEs Debian has deferred, several "code execution via crafted file", and every upload goes through it |
| S3 | Security | Medium | The backend and worker run as root, with all default capabilities |
| S4 | Security | Medium | The app sends no security headers; another site can frame it (clickjacking shown) |
| S5 | Security | Medium | Compromised emSign root CAs are trusted by both certifi and the system bundle |
| S6 | Security | Medium | Images are only rebuilt at release: dozens of fixable OS and Python CVEs, no scanning in CI |
| S7 | Security | Medium | GitHub Actions are pinned to tags, not commit SHAs; release permissions are broader than needed |
| S8 | Security | Low | Criticals that are not reachable here: python-jose, chromadb (client), ecdsa, npm's own tar/minimatch, zod, postcss |
| S9 | Security | Low | ChromaDB server 1.0.0, Postgres and Redis images are behind on patches (internal network only) |
| S10 | Security | Low | Upload handling: sound; hostile media refused; only defence-in-depth left |
| S11 | Security | Low | gitleaks: no real secrets in 384 commits (4 false positives) |
| P1 | Performance | Medium | Layout shift on the dashboard (CLS 0.44 mobile) and settings (0.37 desktop) |
| P2 | Performance | Medium | 60 minutes of Hindi: 30 min to process, 15 of them at "99%" (7.4 min in phrasing alone); a 2,046-caption editor stutters on an ordinary laptop |
| P3 | Performance | Low | The first search after each start takes ~20 s (model load plus a Hugging Face check) |
| P4 | Performance | Low | The app has no favicon: a 404 and a console error on every page |
| P5 | Performance | Low | Site images are ~4× larger than displayed |
| P6 | Performance | Low | `localhost` costs ~210 ms per request on Windows (IPv6 tried first) for scripts |
| SEO1 | SEO | Medium | No Open Graph or Twitter tags or preview image: shared links show no picture |
| SEO2 | SEO | Low | No canonical URL, apple-touch-icon, sitemap.xml or JSON-LD |
| SEO3 | SEO | Low | robots.txt can only live at the domain root (outside this repo); Lighthouse SEO 92 |
| SEO4 | Analytics | Info | GoatCounter is already live (added at Tanush's request on 2026-10-27, d38983d) |
| U1 | UX | Medium | First run is clear and fast; long videos sit at "99%" for 15 min with no explanation; small wording issues |
| U2 | UX | Medium | Several API errors reach the screen as developer text |
| U3 | UX | Medium | Installers suggest `docker system prune`; `vcm update` prunes every dangling image on the machine |
| U4 | UX | Low | On Windows, an installer stop is followed by a red PowerShell stack trace |
| L1 | Legal | **High** | No third-party notices anywhere; the images ship GPL FFmpeg with no source offer |
| L2 | Legal | Medium | No PRIVACY.md or privacy page; the network list in SECURITY.md §6 is incomplete |
| L3 | Legal | Medium | Gemini terms are not passed on to users (free-tier data use, 18+, EEA/UK/CH) |
| L4 | Legal | Low | No "no warranty" or "your videos, your rights" line in the README, site or app |
| L5 | Legal | Info | India's DPDP Act: what is and isn't accurate about "we collect no personal data" |
| M1 | Monitoring | Medium | Models come from 8 Hugging Face repos; 3 unpinned, one already moved, two from one person's account |
| M2 | Monitoring | Medium | Nothing checks that a released version still installs (proposed weekly workflow) |
| M3 | Monitoring | Low | Backup and restore are manual (`vcm backup`/`restore` estimate) |
| M4 | Monitoring | Low | No issue templates; no way for users to collect diagnostics (`vcm doctor`) |
| M5 | Monitoring | Low | No uptime monitor for the site |

The GitHub settings to switch on are in §1.12, and everything only Tanush
can do is in the checklist at the end.

---

## 1. Security

### S1 · High · Next.js 14.2.35 is out of support

**Evidence:**
- `npm audit --omit=dev`: 5 packages, 1 critical, 4 high. `next` alone has
  25 advisories, and every fix is in 15.5.x or 16.x.
- Trivy on `frontend:1.1.0` agrees: 4 critical (3 in `next`), 39 high.

Reachability in our use. The install serves the frontend on `127.0.0.1`
only, but **any web page the user has open can make the browser send GET
requests to `localhost:3000`** (SECURITY.md §1).

| Advisory | Reachable here? |
|---|---|
| GHSA-2464-fhr4-w9xw, GHSA-2xp9-vwfh-vxw4: RCE in the Image Optimization API (SVG, AVIF) | **The endpoint is live**: `GET /_next/image?...` answers, though the app never uses `next/image`. With no `remotePatterns` it only fetches same-origin paths, and uploads can't be SVG or AVIF, so exploiting it needs more than these advisories show. The endpoint should not exist at all. |
| GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-h25m-26qc-wcjf: DoS with Server Components | **Yes.** Any page can send the requests; the effect is a hung or crashed frontend (Docker restarts it). |
| GHSA-ggv3-7p47-pfv8: request smuggling in rewrites | Partly: we use a rewrite, but there is no proxy in front of Next to desync. |
| GHSA-p9j2-gv94-2wf4: SSRF in rewrites via the destination host | No: our destination is the fixed `http://backend:8000`. |
| GHSA-p293-qw3h-jr36: RCE on Windows-hosted servers | No: the server runs in Linux (Alpine). |
| Server Actions advisories (GHSA-m99w…, GHSA-p3m5…, GHSA-89xv…, GHSA-4c39…, GHSA-955p…) | No: there is no `"use server"` in the code. |
| WebSocket SSRF (GHSA-c4j6-fc7j-m34r) | No WebSockets. |
| i18n middleware bypass (GHSA-36qx-fr4f-26g5) | No: no Pages Router, no i18n. |
| postcss, source-map-js, nanoid | No: build time only. |
| zod 3.25.76 (GHSA-mrhx-c7xc-m3w5) | No: used in the browser on the user's own form input. |

**Fix:**
1. Now, at no risk: set `images: { unoptimized: true }` in
   `next.config.js`, which removes the optimiser endpoint.
2. **Upgrade to Next 15.5.28 or later** (Next 15's App Router needs React 19),
   or to 16.4.3. This is a real migration:
   - async `params` and `cookies()`;
   - React 19 typings;
   - the caching defaults change;
   - eslint-config-next.

   Estimate 1–2 days, then the full ui-check and axe pass and the E2E.

Next 14 gets no more security fixes, so this is the one dependency change
that can't wait.

### S2 · High · FFmpeg: crafted-file CVEs on the path every upload takes

**Evidence:**
- Both backend images carry Debian's
  `ffmpeg 7:7.1.5-0+deb13u1` (`--enable-gpl --enable-libx264 --enable-libx265
  --enable-libass`).
- Trivy: **16 high CVEs**, all `fix_deferred` by Debian, so no fixed package
  is coming soon. Among them:
  - code execution via the VobSub, PGS/SUP and DVB (in WTV) subtitle parsers;
  - CAF, PNG, CFHD-in-AVI and Dirac;
  - the NVDEC hardware decoder;
  - the vf_hqdn3d filter;
  - out-of-bounds reads in S/PDIF and DASH.

  Re-run Trivy (S6) for the full list with CVE ids.
- Every upload is probed (`ffprobe`) and decoded (thumbnail, waveform,
  audio extraction). `.avi` and `.mkv` are allowed, and both can carry
  subtitle streams.
- A user who downloads a hostile video from the internet and captions it
  hands it straight to these parsers, in the worker, which runs as root
  (S3) and holds the database password and the Gemini key in its
  environment and database.

**What was tested and held:**
- an HLS playlist renamed `.mp4`, pointing at `file:///etc/passwd` and at
  an internal URL: refused ("Not detecting m3u8/hls with non standard
  extension");
- an `ffconcat` list naming `/etc/passwd`: refused by safe mode;
- corrupt, text-only and empty files: refused cleanly;
- every ffmpeg call already has a timeout (probe 30 s, thumbnail 60 s,
  waveform 300 s, render 3 h).

**Fix:**
1. **Narrow what FFmpeg will parse** on every input
   (`services/media.py`, `transcription.py`, `rendering.py`):
   - `-protocol_whitelist file,pipe`;
   - `-format_whitelist mov,mp4,m4a,3gp,3g2,mj2,matroska,webm,avi` (the
     demuxers of the six allowed extensions);
   - `-codec_whitelist` limited to the common video and audio decoders
     (h264, hevc, vp8, vp9, av1, mpeg4, mpeg2video, mjpeg, prores, aac, mp3,
     opus, vorbis, flac, ac3, eac3, pcm_*);
   - `-sn -dn`, so subtitle and data streams are never decoded.

   This removes the VobSub, PGS, DVB, CAF, PNG, CFHD, Dirac, WTV, RTP/ASF,
   RIST and DASH paths in the CVE list. A file outside the list fails with
   the existing "couldn't be read as a video" message. Add tests with one
   sample per allowed container and one per refused one. Estimate ½–1 day.
2. S3 (non-root, no capabilities) limits what a successful exploit gets.
3. Follow Debian's security tracker for these CVEs (M2's weekly scan
   reports them). If they stay deferred for long, consider an upstream
   FFmpeg 7.1.x point-release build; see L1 for the licence side.

### S3 · Medium · The backend and worker run as root

**Evidence:**
- `docker run … backend:1.1.0-cuda id` prints `uid=0(root)`. There is no
  `USER` in `backend/Dockerfile`, and `HF_HOME` is `/root/.cache`.
- The compose files set no `cap_drop`, `security_opt` or `read_only`.
- The frontend already runs as `app` (uid 100). ✓
- **Ports:** only `127.0.0.1:${VCM_PORT}` is published. Postgres, Redis,
  ChromaDB and the API are on the compose network only (`docker ps`
  confirms). ✓

**Packages:** the runtime image has `curl` (the healthcheck), `apt` and
`perl` (from Debian's base). Nothing else looks unneeded: there's no
compiler, git or ssh.

**Fix:**
1. **Image:**
   - a `vcm` user (uid 10001) in the runtime stage;
   - `HF_HOME=/home/vcm/.cache/huggingface`, keeping the volume mount
     target;
   - an entrypoint step that, while still root, `chown`s the three volumes
     once (existing installs have root-owned files), then drops to `vcm`
     with `setpriv`, which Debian already has.
2. **Compose:** `cap_drop: [ALL]` (add back `CHOWN`, `SETUID`, `SETGID` for
   the entrypoint step only if needed) and
   `security_opt: [no-new-privileges:true]` on backend, worker and
   frontend.
3. **Test:** an update from 1.1.0 with existing data, the GPU worker (NVIDIA
   device access as non-root), and an extra-CA install, since
   `update-ca-certificates` needs root, so it stays in the root part of the
   entrypoint.

Estimate ~1 day.

### S4 · Medium · No security headers; the app can be framed

**Evidence:**
- `curl -D - http://localhost:3000/dashboard` returns only `Content-Type`.
  There is no CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy` or `Permissions-Policy`.
- API responses, including the video stream and thumbnails, have no
  `nosniff`.
- **Clickjacking, shown:** a page served from another origin
  (`127.0.0.1:8099`) with
  `<iframe src="http://localhost:3000/dashboard">` rendered the full app.
- Inside the frame, requests are same-origin, so **the request guard lets
  them through**. A hostile page could overlay the app invisibly and trick
  the user into clicks, for example Delete followed by its confirmation.

**Fix** (`next.config.js` `headers()` for every route; `nosniff` also from
FastAPI middleware):
```
Content-Security-Policy: frame-ancestors 'none'; default-src 'self'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:;
  font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```
- `'unsafe-inline'` for scripts is what Next 14's App Router needs without
  nonces. Its inline bootstrap scripts are the reason. `frame-ancestors` is
  the part that matters most.
- Check that the font preview (FontFace from `/api/fonts`), `blob:`
  thumbnails and the video still work.
- ui-check and axe must stay at 0.

Estimate ½ day.

### S5 · Medium · Compromised emSign roots are trusted

**Evidence:**
- pip-audit and Trivy: **certifi 2026.7.22** (critical, GHSA-6q48-6c7w-9gw2,
  "bundles emSign root CAs with compromised intermediate CA keys"); fixed
  in 2026.10.18.
- The image points every client at the system bundle
  (`SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE`), but **Debian's `ca-certificates
  20250419` in the image also has the four emSign roots**
  (`/usr/share/ca-certificates/mozilla/emSign_*.crt`). So the override
  doesn't help.
- What a network attacker holding those keys could intercept:
  - model downloads: Whisper and MiniLM are unpinned and unhashed, M2M100
    is pinned but unhashed, Apex and IndicXlit are hash-checked;
  - the Gemini key and caption text;
  - Google Fonts.

**Fix:**
- In the runtime stage, disable the emSign roots: `!mozilla/emSign_*` lines
  in `/etc/ca-certificates.conf`, then `update-ca-certificates`.
- Bump certifi to 2026.10.19 or later.
- Drop the override once Debian ships a bundle without them.

Estimate 1 hour plus a rebuild.

### S6 · Medium · Patch level depends on the release cadence

**Evidence (Trivy, CPU and CUDA images identical, Debian 13.6):** 8
critical, 290 high, 414 medium. Most are in packages the app never runs:

| Package | High/Crit | Fix available | Reachable? |
|---|---|---|---|
| ffmpeg and libav* | 16 | none (deferred) | **yes**: S2 |
| libxml2 | 8 (1 critical) | none | low: only via FFmpeg's DASH demuxer, removed by S2's whitelist |
| perl-base | 8 (3 critical) | 7 | no: nothing runs perl |
| util-linux, mount, login, bsdutils… | 8 | 4 | no: no mount or setuid use |
| curl, libcurl | 5 | 3 | no: the healthcheck to 127.0.0.1 only |
| openssl | 2 | 2 | low: a QUIC server DoS and DTLS (we use neither) |
| libexpat, pcre2, sqlite, gzip, brotli, librsvg | 13 | 13 | low |
| libcjson, libtiff, libsndfile, libx11… | 10 | none | low |

Python packages (pip-audit, the same 43 advisories in both images):

| Package | Severity | Reachable? |
|---|---|---|
| certifi 2026.7.22 | critical | **yes**: S5 |
| python-jose 3.5.0 | critical (algorithm confusion with DER public keys) | no: tokens are HS256 with a secret, `algorithms=[…]` fixed (`utils/security.py`) |
| chromadb 1.5.9 | 2 critical, 2 high | no: the advisories are in Chroma's Python **server**; we only use `chromadb.HttpClient` |
| aiohttp 3.14.3 | 3 high | no: no aiohttp server; it's only a dependency of google-genai, fsspec and others |
| urllib3 2.7.0 | 2 high | low: needs a malicious server or an HTTPS proxy |
| filelock 3.32.2 | 1 high | no: a local-attacker symlink on `ReadWriteLock` |
| ecdsa 0.19.2 | 1 high (timing) | no: unused (HS256) |
| pip 24.0, setuptools, wheel | moderate/low | no: not used at runtime |

**Fix:**
- `apt-get upgrade -y` in the runtime stage (or a newer
  `python:3.11.x-slim-trixie` digest).
- Bump the Python constraints (certifi, aiohttp, urllib3, filelock).
- Delete pip, setuptools and wheel from the runtime venv.
- Add a Trivy step to `release.yml` that fails on a **fixable**
  critical/high.
- M2's weekly workflow reports new ones between releases.
- Replace python-jose with PyJWT (an active project; 10 lines in
  `utils/security.py`).

Estimate ½ day. Note: changing `constraints.txt` rebuilds the dependency
layer, so that update will be ~0.8 GB (CPU) / 2.3 GB (CUDA) for users;
batch it with S2/S5.

### S7 · Medium · GitHub Actions supply chain

**Evidence:**
- **Pinned to tags, not SHAs** (`.github/workflows/*.yml`), all nine:
  `actions/checkout@v4`, `setup-node@v4`, `configure-pages@v5`,
  `upload-pages-artifact@v3`, `deploy-pages@v4`,
  `docker/setup-buildx-action@v3`, `docker/login-action@v3`,
  `docker/build-push-action@v6`, `softprops/action-gh-release@v2`.
- A moved tag would run new code with `packages: write`, which pushes the
  images every install pulls, and `contents: write`, which edits releases
  and the installer assets.
- **Permissions:**
  - `release.yml` gives `contents: write` and `packages: write` to both
    jobs (the `images` job needs only `packages`, the `release` job only
    `contents`);
  - `ci.yml` has no `permissions:` block, so it gets the repository default;
  - `pages.yml` is already least-privilege. ✓
- **Pull requests:** `ci.yml` runs on `pull_request`, never
  `pull_request_target`, and uses no secrets. Fork PRs get a read-only
  token. ✓ `release.yml` runs only on `v*` tags and by hand. ✓

**Fix:**
- Pin every action to a full commit SHA with the version as a comment, and
  let Dependabot (`.github/dependabot.yml`, ecosystem `github-actions`)
  propose updates.
- Add `permissions: contents: read` to `ci.yml`, and per-job permissions in
  `release.yml`.
- The repo settings in §1.12 (tag protection, fork approval) complete it.

Estimate 1 hour.

### S8 · Low · Critical/High that don't apply here

Recorded so they aren't re-investigated each time:
- **python-jose, chromadb, ecdsa, aiohttp, filelock:** see S6.
- **Frontend `tar`, `minimatch`, `brace-expansion`, `glob`, `cross-spawn`,
  `ip-address`, `http-cache-semantics`, `pacote`, `sigstore`:** 22 of
  Trivy's 39 highs plus 1 of its 4 criticals. They all live in
  `/usr/local/lib/node_modules/npm`, npm itself, which the running server
  never uses.

**Fix:** in the frontend runtime stage, `rm -rf
/usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack
/usr/local/bin/npm /usr/local/bin/npx`. That's −17 MB and these findings
disappear.

### S9 · Low · Third-party service images

**Evidence (Trivy, High and Critical only):**

| Image | Result |
|---|---|
| `chromadb/chroma:1.0.0` | Debian 12.10, 6 critical, 78 high, mostly base packages (perl, gnutls, zlib, pam). The backend's client is chromadb **1.5.9**, so client and server are far apart. |
| `postgres:16.14-alpine` | 1 critical and 33 high in `gosu`'s Go stdlib (runs once at start), and OpenSSL |
| `redis:7.4.10-alpine` | 4 high (OpenSSL) |

None is published outside the compose network.

**Fix:** move ChromaDB to the newest 1.x server that the 1.5.9 client
supports, after an index round-trip test. Bump Postgres and Redis to their
current patch tags at each release (M2 flags them).

### S10 · Low · Upload and download handling

**Evidence:** reviewed against SECURITY.md §7, and it holds:
- **File type:** both the extension and the declared content type must be
  on the allow-lists (415 otherwise).
- **Size:** counted while streaming (413); a full disk gives 507 and the
  partial file is deleted; an empty file gives 400.
- **Stored name:** a fresh UUID; the user's filename is only a label.
- **Paths:** `storage.resolve()` refuses anything outside the root.
- **Download names:** `safe_stem` drops directories, control characters
  (CR/LF) and reserved characters, and caps the length.
- **Hostile media:** see S2.

What's left is defence in depth: S2's whitelists, and `nosniff` (S4) on
`/stream` and `/thumbnail`. One more: uvicorn's access log records
`/stream?token=…`, a 60-minute stream token. M4's `vcm doctor` must redact
`token=` values.

### S11 · Low · Secrets in git history

**Evidence:** gitleaks 8.30.1 over all 384 commits (`--redact`): 4 hits, all
false positives:
- `.env.example:16`: the placeholder `replace-…`;
- `backend/tests/test_local_install.py:247`: a made-up key used to prove the
  real one is never logged;
- `backend/app/data/google_fonts.json` (2): font IDs stored under a field
  called `key`.

**Fix (optional):** a `.gitleaks.toml` allow-list for those paths, and a
gitleaks step in `ci.yml`.

### 1.12 GitHub settings to switch on (Tanush)

Visible from outside: `main` is **not protected**; there are no issue
templates and no Dependabot config. GitHub reads the security policy from
`docs/SECURITY.md`. ✓

1. **Settings → Code security:**
   - Private vulnerability reporting is **already enabled** (the API reports
     `"enabled": true`). ✓
   - **Dependabot alerts** and **Dependabot security updates:** Enable.
   - **Secret scanning** and **Push protection:** Enable.
   - **Code scanning → CodeQL → Default setup** (Python, JavaScript/TS,
     Actions).
2. **Settings → Rules → Rulesets:**
   - **main:** block force pushes, block deletion, require linear history.
     Optionally require the `ci` checks to pass; since you push directly,
     allow yourself to bypass.
   - **Tags `v*`:** restrict creation, update and deletion to you. A pushed
     tag publishes a release and images.
3. **Settings → Actions → General:**
   - Workflow permissions: **Read repository contents and packages**;
     untick "Allow GitHub Actions to create and approve pull requests".
   - Fork pull request workflows: **Require approval for all external
     contributors**.
   - Optionally: "Require actions to be pinned to a full-length commit SHA"
     (after S7).
4. **Packages (GHCR):** for both packages, Package settings → Manage Actions
   access: only this repository, with **Write**. Keep them **Public**:
   installs pull anonymously, which was confirmed working.
5. **Account:** two-factor authentication on, with a hardware key or passkey
   if you have one. Your account is the root of the whole release chain
   (SECURITY.md §8).
6. **Pages:** "Enforce HTTPS" is on by default; leave it.

## 2. Performance and speed

### 2.1 Lighthouse: the app (production build, the install on port 3000)

| Page | Device | Perf | A11y | Best pr. | SEO | LCP | CLS |
|---|---|---|---|---|---|---|---|
| Dashboard | desktop | 99 | 100 | 96 | 100 | 1.0 s | 0.003 |
| Dashboard | mobile | 62 | 100 | 96 | 100 | 5.1 s | **0.438** |
| Editor (video 84) | desktop | 89 | 96 | 96 | 100 | 2.3 s | 0.011 |
| Editor (video 84) | mobile | 69 | 100 | 93 | 100 | 12.3 s | 0.150 |
| Settings | desktop | 81 | 100 | 96 | 100 | 1.0 s | **0.371** |
| Settings | mobile | 80 | 100 | 96 | 100 | 5.1 s | 0.078 |

The mobile runs use Lighthouse's simulated slow 4G and 4× slower CPU, which
overstates load times for an app served from the same computer. Layout
shift is real at any speed.

### P1 · Medium · Layout shift on the dashboard and settings

**Evidence:**
- **Dashboard (mobile):** CLS 0.438. The culprit is
  `<div class="transition-opacity duration-200">`: the library block fades
  in and pushes the page down.
- **Settings (desktop):** CLS 0.371. `<main>` shifts when the system
  information arrives.
- Google counts above 0.25 as "poor".

**Fix:** reserve the final height while loading, using placeholder rows the
size of the real ones, or a `min-height` from the last known count. Fade in
without moving anything. Estimate ½ day, checked with Lighthouse and
ui-check.

### P2 · Medium · Scale: a 60-minute video with 1,000+ captions

**The test:**
- **The video:** `test-assets/hinglish.mp4` (3:48, Hindi) looped to 60:00,
  stream copy, 982 MB.
- **The upload:** to the install (GPU, large-v3, "Same as spoken"); 4.9 s.
- **The result:** **2,046 captions**, Devanagari. Total processing
  **1,798 s (30 min)**.

**The worker**, sampled every 5 s:
- **RAM:** 0.97 GiB idle, **1.26 GiB peak**, flat throughout. No growth
  with length; fine for the 8 GB minimum.
- **GPU memory:** +1.6 GB over idle.

**Where the time went** (worker log):

| Time | Stage | Progress shown |
|---|---|---|
| 0–870 s | first transcription pass (GPU) | 0 → 99% |
| 870–1,340 s | re-decoding gaps ("Recovered N segment(s)…", GPU) | **99%** |
| 1,340–1,782 s | **7.4 min with one CPU core at 100%, GPU idle, nothing logged**: between "1451 segments (hi)" and the search index | **99%** |
| last 8 s | search index (MiniLM loaded, and Hugging Face contacted again: P3) | 99% → done |

The silent 7.4 minutes come after transcription and before indexing,
where the worker runs `phrasing.rephrase` (step 3), then saves the
captions (step 4); no translation was asked for. Saving 2,046 rows takes
seconds. `phrasing.split_phrases` is a dynamic programme over a
sentence's words (`for k … for j … for i …`), so its cost grows with the
**cube** of a sentence's length.

A sentence ends only at punctuation or a 1 s pause (`_sentences`). Hindi
from Whisper often has neither for a long stretch, so a long talk produces
very long "sentences". For a 3:48 clip this is invisible; for an hour it
is minutes.

**The editor with 2,046 captions** (Playwright, 1440×900; frame times by
`requestAnimationFrame`, long tasks by PerformanceObserver):

| | This PC | CPU slowed 4× (an ordinary laptop) | Baseline: video 84, 159 captions, 4× |
|---|---|---|---|
| Editor ready | 0.75 s | **5.1 s** | 0.75 s |
| DOM nodes / JS heap | 76,500 / 74 MB | 76,500 / 65 MB | 6,800 / 10 MB |
| Scrolling the list | smooth (1 frame of 67 ms) | smooth | smooth |
| Playback, 8 s | 13 long tasks, max 76 ms | **17 long tasks up to 461 ms**: visible stutter at each caption change | 3, max 58 ms |
| Typing 20 characters | max 133 ms | p95 50 ms, **hitches of 450 ms** | n/a (not typed on a user's video) |

The caption list renders every row (`captions.map` in
`caption-editor.tsx`; ~37 DOM nodes per caption), and the active-caption
change re-renders all of them. The timeline is already windowed, and it
isn't the problem.

**Fix:**
1. **Phrasing:** profile `rephrase` on video 105's segments (they can be
   re-created from the same test file) and bound `split_phrases`: split
   over-long runs at the largest word gap or at most every ~40 words before
   the DP, so its cost becomes linear in the video. Then confirm
   `timing_check.py` and `coverage_check.py` pass unchanged on the FLEURS
   clips (docs/TESTING.md). Estimate ½–1 day.
2. **Progress honesty:** report the gap re-decode and phrasing as their own
   stage ("Checking for missed speech", "Arranging captions") with real
   percentages, instead of "Transcribing 99%" (see U1).
3. **The editor:**
   - window the caption list with the existing `lib/windowing.ts` (already
     used by the font picker);
   - memoise `CaptionRow` so an active-caption change re-renders two rows,
     not 2,046.

   Keep auto-scroll to the active caption and the keyboard order. Estimate
   1 day, plus ui-check and axe.

### P3 · Low · The first search after each start is slow, and it calls Hugging Face

**Evidence:**
- **Timings:** `GET /api/search` took **19.7 s** the first time after the
  stack started, then **0.02 s**, three times in a row.
- **The network call:** the backend log at that moment shows "Warning: You
  are sending unauthenticated requests to the HF Hub". MiniLM is loaded by
  name (`SentenceTransformer(settings.embedding_model)`, `embeddings.py:31`),
  unpinned. So after each restart the API contacts huggingface.co, even
  with the model cached.
- **Why it matters:** this contradicts SECURITY.md §6 and the README ("no
  outbound requests"), and costs a network round-trip or timeout when
  offline.

**Fix:**
- Load MiniLM like the other models: through `model_store`, at a pinned
  revision, with `local_files_only=True` once present.
- Warm the encoder when the API starts, in the background.

Estimate 2 hours.

### P4 · Low · No favicon in the app

**Evidence:** `GET /favicon.ico` returns 404 on every page. Lighthouse
records it as "Browser errors were logged to the console" (Best Practices
93–96).

**Fix:** add `app/icon.svg`; reuse the site's favicon.

### P5 · Low · Site images bigger than needed

**Evidence:**
- **Image sizes:** the four WebPs are 1,357–1,707 px wide (32–99 kB),
  while the gallery shows them ~350 px wide. Lighthouse estimates ~85%
  could be saved.
- **Caching:** GitHub Pages fixes the cache at `max-age=600`; that can't be
  changed.

**Fix:**
- 800 px and 1,600 px variants with `srcset`/`sizes`.
- Add `fetchpriority="high"` on the hero image.

Estimate 1 hour.

### P6 · Low · `localhost` is slow for scripts on Windows

**Evidence:**
- **Measured with `curl`:** every request to `http://localhost:3000` took
  ~210 ms, even `/api/health` (20 bytes). The same requests to `127.0.0.1`
  took 3–12 ms.
- **Why:** Windows tries `::1` first, and the port is published on IPv4
  only. Browsers race both and don't notice.

**Fix:** use `127.0.0.1` in `vcm` and `vcm.ps1` (`Wait-Ready`, `/api/health`
polling) and in `scripts/e2e.py`. Keep showing `localhost` to users.

### 2.2 API response times (install, 10 warm requests each, via 127.0.0.1)

| Endpoint | Median | Max |
|---|---|---|
| `/api/health` | 3 ms | 21 ms |
| `/api/videos`, `/api/videos/84`, `/api/stats` | 6 ms | 32 ms |
| `/api/videos/84/captions` (159 captions, 31 kB) | 7 ms | 21 ms |
| `/api/videos/84/waveform` (13 kB) | 12 ms | 32 ms |
| `/api/system` | 11 ms | 31 ms |
| `/api/videos/84/exports/options` | 81 ms | 103 ms (runs ffprobe each call) |
| `/api/fonts?limit=60`, `/api/styles/options` | 3 ms | 29 ms |
| `/api/search` | 20 ms warm; 19.7 s cold (P3) | |

Nothing to fix apart from P3.

### 2.3 Frontend bundle per page (shipped build, gzip)

| Route | First-load JS | Page's own JS |
|---|---|---|
| `/dashboard` | 174 kB | 39 kB |
| `/editor/[id]` | 196 kB | 60 kB |
| `/settings` | 158 kB | 22 kB |
| `/search`, `/search/[id]` | 164–165 kB | 28–29 kB |

These are reasonable for a local app. `next.config.js` has
`compress: false`, so the browser actually receives them uncompressed
(505–628 kB). Over localhost that costs nothing measurable; no change
proposed.

### 2.4 Site (live, GoatCounter's count URL blocked during the runs)

| Device | Perf | A11y | Best pr. | SEO | LCP | CLS | Weight |
|---|---|---|---|---|---|---|---|
| Desktop | 99 | 100 | 100 | **92** | 1.0 s | 0 | 271 kB |
| Mobile | 100 | 100 | 100 | **92** | 1.4 s | 0 | 271 kB |

Every category is at 95 or above except SEO. The 92 is entirely
"robots.txt is not valid" (SEO3).

## 3. SEO and analytics (landing site)

What `site/index.html` has today:

| Item | Status |
|---|---|
| `<title>` | ✓ "VideoCaptionMaker: private, offline AI captions" |
| `<meta name="description">` | ✓ |
| `lang` | ✓ `en` |
| Favicon | ✓ SVG |
| apple-touch-icon | ✗ |
| Canonical URL | ✗ |
| Open Graph and Twitter card, 1200×630 image | ✗ |
| robots.txt | ✗ (and see SEO3) |
| sitemap.xml | ✗ |
| JSON-LD `SoftwareApplication` | ✗ |

### SEO1 · Medium · No link preview

**Evidence:**
- With no `og:` or `twitter:` tags, LinkedIn and WhatsApp fall back to the
  `<title>` and maybe the description, with **no image**.
- LinkedIn's Post Inspector needs a login, so the before and after
  previews are Tanush's to check (checklist).

**Fix (phase 2):**
- A 1200×630 PNG preview, `site/og.png`: the editor screenshot on the page
  background, with the headline in the system font, made from the site
  itself with Playwright so it matches.
- These tags:
```html
<link rel="canonical" href="https://tanush1206.github.io/Video-Caption-Maker/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="VideoCaptionMaker">
<meta property="og:title" content="VideoCaptionMaker: private, offline AI captions">
<meta property="og:description" content="Captions for your videos, made on your own computer…">
<meta property="og:url" content="https://tanush1206.github.io/Video-Caption-Maker/">
<meta property="og:image" content="https://tanush1206.github.io/Video-Caption-Maker/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="The VideoCaptionMaker caption editor">
<meta name="twitter:card" content="summary_large_image">
```
- `og:image` must be an absolute URL.
- The CSP meta tag doesn't affect crawlers.

### SEO2 · Low · Canonical, icons, sitemap, structured data

**Fix (phase 2):**
- **`apple-touch-icon.png`:** 180×180, from `favicon.svg`.
- **`sitemap.xml`:** one URL.
- **JSON-LD** in a `<script type="application/ld+json">`. It is data, not
  script, so the CSP doesn't block it:
  ```json
  {"@context":"https://schema.org","@type":"SoftwareApplication",
   "name":"VideoCaptionMaker","applicationCategory":"MultimediaApplication",
   "operatingSystem":"Windows, Linux",
   "offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},
   "license":"https://opensource.org/licenses/MIT",
   "downloadUrl":"https://github.com/Tanush1206/Video-Caption-Maker/releases/latest",
   "softwareVersion":"1.1.0","author":{"@type":"Person","name":"Tanush Thakran"},
   "image":"https://tanush1206.github.io/Video-Caption-Maker/og.png"}
  ```
- Check it with Google's Rich Results Test.
- `softwareVersion` has to change at each release. Add it to the release
  checklist, or leave it out.

### SEO3 · Low · robots.txt belongs to the domain root

**Evidence:**
- Crawlers and Lighthouse read only
  `https://tanush1206.github.io/robots.txt`, which returns 404. That
  folder is served by a repository named `Tanush1206.github.io`, which
  doesn't exist.
- A `site/robots.txt` would be served at `/Video-Caption-Maker/robots.txt`,
  where nobody reads it.
- With no robots.txt at all, crawlers allow everything. So this costs
  Lighthouse points only, not indexing.

**Fix (Tanush's choice):**
- **Leave it:** SEO stays 92, and indexing is unaffected. Submit
  `sitemap.xml` directly in Search Console and Bing.
- **Or create the repo `Tanush1206.github.io`** with a robots.txt
  (`User-agent: *`, `Allow: /`, `Sitemap: https://tanush1206.github.io/Video-Caption-Maker/sitemap.xml`).
  SEO goes to 100. That repo also becomes your root site.

### SEO4 · Info · Analytics

The brief said to propose GoatCounter and wait. It was already added at your
request earlier the same day (d38983d, live):
- page views;
- `copy-windows`/`copy-linux` and `os-windows`/`os-linux` events;
- count.v5.js pinned with SRI;
- the CSP allows only `gc.zgo.at` and `vcm.goatcounter.com`;
- a footer line saying so.

Nothing more to do apart from the privacy page (L2).

### Search Console and Bing: the steps you do

**Google Search Console:**
1. Go to https://search.google.com/search-console → **Add property** →
   **URL prefix** (not Domain: github.io's DNS isn't yours). Enter
   `https://tanush1206.github.io/Video-Caption-Maker/`.
2. Choose **HTML tag**, copy the `content` value, and send it to me. I add
   `<meta name="google-site-verification" content="…">` to
   `site/index.html`. Alternatively choose **HTML file**, send me the
   file, and I add it to `site/`. It's served under the property's prefix,
   which is all Google checks.
3. After the push deploys (about a minute), click **Verify**.
4. **Sitemaps:** submit `sitemap.xml` (after SEO2).
5. **URL inspection** → the home page → **Request indexing**.

**Bing Webmaster Tools:**
1. Go to https://www.bing.com/webmasters → **Import from Google Search
   Console** (sign in with the same Google account). It verifies and copies
   the sitemap, so nothing has to be added to the site.
2. If you'd rather verify separately, choose the meta tag option and send me
   the `msvalidate.01` value.

## 4. User experience and design

### U1 · Medium · First run: install → first upload → first export

**How it was done:**
- **Install:** the installers were read in full, and both Docker failures
  were triggered for real (U4). A clean second install wasn't possible on
  this machine: the installer's project name `vcm` would have replaced
  your install.
- **Upload to export:** driven in the real app (port 3000, GPU) with
  Playwright as a newcomer would. Test video 106 was the 3:48 Hindi clip,
  with the defaults throughout. Screenshots were taken at each step, and I
  can attach them on request.
- **What can't be seen here:** the models were already downloaded on this
  machine, so the first-use downloads (0.5–3 GB of speech model, 1.6 GB
  for Hinglish, 1.3 GB for translation) were read from the code and
  README, not watched.

| Step | What happened | Time |
|---|---|---|
| Dashboard | One clear action ("Choose video"), "Everything runs on this computer." | — |
| Choose a file | The language step appears **while the file uploads**: "Hindi · heard at 98%", Hindi script preselected **Hinglish (Roman)**, "Caption into: Same as spoken" | detection 0.75 s |
| Start | The "Pipeline" card: named stages, each with a one-line explanation, "You can leave this page; it carries on." | — |
| Captions ready | 159 captions, Roman script; the editor opens in place | **~17 s** from Start (GPU) |
| Export | A dialog: format list, file name, resolutions up to the source's, "Previous exports" | — |
| Render | MP4 1080p | **15.8 s**; 185 MB from a 62 MB source |

**Good:**
- the language step overlapping the upload;
- the clear pipeline;
- the editor appearing in place;
- the export dialog's wording ("Source: 1080p. The source's own size:
  nothing is resampled").

**Confusing or unexplained moments:**
1. **Long videos sit at "99%" with no explanation** (P2). For the 60-minute
   video, progress read 99% from 14.5 to 30 minutes. A user will think it
   has hung. → Separate stages for the gap re-decode and phrasing, and an
   estimate up front: "about N minutes for a video this long on this
   computer", from the duration and the hardware tier.
2. **First use downloads up to 6 GB with no warning beforehand.** The
   pipeline does show "Downloading the speech model. This happens once."
   with GB progress, but nothing warns *before* Start.
   - Fix: on the language step, when a needed model isn't downloaded, add
     one line: "First time: downloads the speech model (3 GB), once."
     `/api/system` already reports `hinglish_model.downloaded`. Add the same
     for the Whisper and M2M100 models.
3. **Export doesn't download.** "Appears in the list above; download it from
   there." A newcomer expects the file to arrive.
   - Fix: when the render finishes and the dialog is still open, start the
     download (or focus the new row's Download button), and say where the
     file went.
4. **"Transcribing with faster-whisper"** names a library. → "Turning
   speech into captions".
5. **The header reads "Hindi → Same language".** → "Hindi captions" (or
   "Hindi → Hinglish" when Roman is chosen).
6. **Exported files are about 3× the source** (185 MB from 62 MB at the same
   1080p). → Mention the size in the export dialog before rendering
   ("about 190 MB"). Or consider a slightly higher CRF / NVENC CQ; measure
   quality first.
7. **Install:** see U3 (the prune advice) and U4 (the stack trace). The
   installer's other messages are clear and each gives a next step.

### U2 · Medium · Error messages that read like developer text

The frontend shows the API's `detail` text as it is (`lib/api.ts`,
`lib/upload.ts`). Most messages are good: they're plain and give a next
step, for example the model-download errors (`model_store.py`), the worker's
`friendly_error`, "The disk is full, so the video couldn't be saved. Free
some space and try again.", and "An export can't be larger than the video
(1080p)".

These are not:

| Where | Today | Problem | Proposed |
|---|---|---|---|
| Upload, 415 | "Unsupported content type: video/x-ms-wmv" / "Unsupported file extension: .wmv" | jargon; no list | "VideoCaptionMaker can't open .wmv files. Use MP4, MOV, MKV, WebM, AVI or M4V; any converter (e.g. HandBrake) can make an MP4." |
| Upload, 413 | "File exceeds the 4096MB limit" | no next step | "This video is larger than 4 GB, the most the app accepts. Trim it or export it at a lower quality first." |
| Upload, network | "Network error during upload" (`upload.ts:73`) | no next step | reuse the status-0 text: "The upload was interrupted. Check that the app is running (vcm status) and try again." |
| Any 422 from validation | Pydantic text, e.g. "Field required, Input should be …" | developer text | map 422 arrays to "Something in that request wasn't valid. Reload the page and try again." and log the detail |
| Export | "This export is failed, not ready to download" | enum value in a sentence | "This export failed. Make it again from Export." / "…is still rendering." |
| Export/stream | "Export file is missing", "Video file is missing", "Thumbnail file is missing" | no next step | "The file for this export is gone from the app's storage. Make the export again." and so on |
| Queue | "Could not reach the processing queue. Please try again." | no hint why | "The app's background service isn't responding. Run `vcm restart`, then try again." |
| Worker | "Transcription failed unexpectedly. Try again; if it keeps failing, check the logs." | "the logs" unexplained | "…if it keeps failing, run `vcm logs worker` and attach the output (or `vcm doctor`, M4) to a bug report." |
| Editor | "start_ms must be less than end_ms" | internal field names | "A caption has to end after it starts." |
| Tokens | "Invalid or expired stream token" | appears if the editor is left open past 60 min | refresh the token silently on a 401/403 from `/stream`; if that fails, "Reload the page to keep playing." |

Estimate ½ day, plus a test that every `HTTPException` detail is a full
sentence.

### U3 · Medium · Installer and `vcm update` cleanup touches other projects

**Evidence:**
- **The low-disk message suggests `docker system prune`:**
  `install.ps1:87` and `install.sh:98`.
  - On a developer's machine that deletes every stopped container, unused
    network, dangling image and the build cache of **all** their projects.
  - This is the exact cleanup AGENTS.md rule 16 forbids for us.
- **`vcm update` ends with `docker image prune -f`** (`vcm:91`,
  `vcm.ps1:106`): every dangling image on the machine, not only ours.

**Fix:**
- Replace the advice with "Free some space on <drive>, or remove old
  VideoCaptionMaker images with: `vcm clean`".
- In `vcm update`, prune only our images:
  `docker image prune -f --filter "label=org.opencontainers.image.source=https://github.com/Tanush1206/Video-Caption-Maker"`
  (both images carry that label).

Estimate 1 hour.

### U4 · Low · A stack trace after a clear installer message (Windows)

**Evidence:** with Docker missing (PATH without `docker`) and with Docker
not running (`DOCKER_HOST` pointed at a missing pipe), the installer prints
a clear message and next step:
```
  [x] Docker Desktop is installed but not running.
      Start Docker Desktop from the Start menu, wait until it says "Engine running",
      then run this installer again.
```
and then PowerShell's red block:
```
At line:34 char:9
+         throw "Installation stopped: $m"
    + CategoryInfo          : OperationStopped: …
```
That looks like a crash.

**Linux/macOS (`install.sh`, read):**
- **Docker missing:** an install link, plus the `get.docker.com` one-liner.
- **Permission denied:** the `usermod -aG docker` advice.
- **Not running:** `systemctl start docker`, or "Start Docker Desktop" on
  macOS.
- **Low disk:** the free and needed GB (but see U3).
- **No GPU:** "using the CPU (works everywhere, just slower)".
- **GPU found but Docker can't use it:** a Container Toolkit link, then
  "Continuing with the CPU for now".

All good.

**Fix:** in `install.ps1`, have `Fail` print and then exit the script block
quietly, instead of `throw`. Don't use `exit`, which would close the user's
window under `irm | iex`. For example, wrap the body in `try { … } catch
[VcmStop] { }`. Estimate 1 hour, tested with both failures above.

**Smaller notes:**
- The GPU needs 12 GB of disk and the README's minimum says 8 GB.
- "Downloading the app (first time: a few GB…)" could give the actual size
  per variant (1.2 GB CPU, 2.6 GB NVIDIA, from the README).

### 4.2 Usability test script (5 tasks, for someone who has never seen the app)

**Setup:**
- A Windows laptop with Docker Desktop running, and the app **not**
  installed.
- Two files on the desktop:
  - `hindi-talk.mp4`: someone speaking Hindi, 2–4 min;
  - `english-clip.mov`: English speech, under 2 min.
- Open the landing page in a browser.
- Say: "Think aloud. There are no wrong answers; we're testing the app, not
  you. I can't help, but you can give up on a task." Note the time at the
  start and end of each task.

| # | Task (read it out exactly) | Done when | Watch for |
|---|---|---|---|
| 1 | "Install VideoCaptionMaker from this web page." | The app opens in the browser | Do they find the command and the Windows/Linux switch? Do they know where to paste it (PowerShell)? Do they read "Docker Desktop must be running"? Do they wait out the download, or think it froze? |
| 2 | "Make English captions for english-clip.mov and download them as a subtitle file." | They have an `.srt` or `.vtt` | Upload: drag or button? Do they understand "Same as spoken"? The first-video model download: do they understand the wait? Do they find Export, and SRT under it? |
| 3 | "Make captions for hindi-talk.mp4 in Hinglish (Hindi in English letters) and export an MP4 with the captions on the video." | They have an MP4 with Roman-script captions | Do they find the Hindi script choice (Roman vs Devanagari)? Do they understand "Hinglish"? Wait time, the export resolution choice, where the file lands |
| 4 | "In the Hinglish video, fix one caption that's wrong, make the captions bigger and yellow, and export again." | The new MP4 shows the edit and the style | Do they find the caption list vs the video overlay? Is saving automatic, or do they look for Save? The style panel: font size and colour. Do they notice the preview matches the export? |
| 5 | "Find the moment in either video where a particular thing is said (give them a phrase from the video), then delete the English video from the app." | They jump to the moment, then the video is gone | Search by meaning: do they trust a match whose words differ? Delete: where, and is the confirmation clear? Do they think the file on their desktop is deleted too? |

**After the tasks:**
- "What was confusing?"
- "When did you wait without knowing why?"
- "Would you use this instead of what you use now? Why or why not?"
- Rate ease from 1 to 5.

**Record:**
- time per task;
- wrong turns;
- every question asked;
- the exact words used for things (they often become better labels).

## 5. Legal and compliance

*Not legal advice. These are facts gathered from the images and
licences, and the usual ways projects meet them. Have anything you're
unsure about checked.*

### L1 · High · No third-party notices; GPL FFmpeg distributed without a source offer

**Evidence:**
- **What GHCR distributes:** the backend images (CPU and CUDA) contain:
  - 305 Debian packages, including **GPL** ones;
  - FFmpeg built `--enable-gpl` with libx264 and libx265 (GPL-2.0+). CPU
    exports use libx264 (`rendering.py:166`), so the FFmpeg binaries we
    ship are GPL-2.0-or-later as a whole;
  - 139 Python packages, or 142 in CUDA;
  - NVIDIA's cuBLAS, cuDNN and NVRTC (CUDA image only).
- **The frontend image** carries Node and 39 npm production packages.
- **Licence texts present:** each Debian package's licence is already in
  `/usr/share/doc/*/copyright` (305 files, including ffmpeg and libx264),
  and the bundled fonts' OFL texts are in `/usr/share/fonts/truetype/vcm/`.
- **Missing:** there's no `/licenses`, no THIRD_PARTY_NOTICES, and no
  source offer.

What distributing a GPL binary in a public image requires (GPLv2 §3):
- the licence text, which Debian's copyright files cover;
- **and** either the complete corresponding source alongside it, or a
  written offer, valid for 3 years, to provide it.

Pointing at Debian's archive is what most Debian-based images do in
practice. It's weaker than shipping or offering the source yourself, because
Debian's mirrors eventually drop old versions; `snapshot.debian.org` keeps
them.

This applies to **any** Debian-based image, including bash and coreutils,
not just FFmpeg. Our own MIT code runs FFmpeg as a separate program
(`subprocess`), which doesn't make it GPL.

**Switch to an LGPL FFmpeg?** Not recommended:
- An LGPL build has **no libx264**, so CPU exports would need another
  H.264 encoder. OpenH264 (BSD) is lower quality, and Cisco's patent cover
  only applies to their own binary.
- NVENC works in an LGPL build, but only for GPU users.
- The GPL obligations for the rest of the Debian base remain anyway.

Keeping Debian's build and complying is simpler and keeps export quality.

**Fix (phase 2):**
1. **`THIRD_PARTY_NOTICES.md`** in the repo:
   - the app's MIT licence;
   - the models and their licences, with Apache-2.0 NOTICE where a repo
     has one;
   - the bundled fonts (OFL-1.1: Anton, Barlow Condensed, Bebas Neue, Lato,
     Noto Sans and its Indic scripts, Poppins), plus Debian's DejaVu,
     Liberation and Noto Core;
   - the Google Fonts catalogue: 1,792 fonts under OFL, 35 under
     Apache-2.0 and 5 under the Ubuntu Font Licence. Users download them
     themselves at runtime; we ship only the catalogue's names and paths;
   - FFmpeg (GPL-2.0+, with the build flags);
   - NVIDIA CUDA libraries (NVIDIA's licence: redistribution of these
     runtime libraries is permitted with an application, on the condition
     that their licence terms come with them);
   - the Python and npm packages, grouped by licence. The MPL-2.0 ones
     (certifi, orjson, tqdm) also need "source at <URL>". caniuse-lite
     (CC-BY-4.0) needs attribution.
2. **`/licenses` in each image**, generated at build time:
   - `THIRD_PARTY_NOTICES.md` and `LICENSE`;
   - `pip-licenses --with-license-file` output for the venv;
   - the licence files of the npm production packages (frontend);
   - the model licences;
   - the NVIDIA licence files from the wheels (CUDA image);
   - a `SOURCES.md` with the source offer, below.
3. **Source for the GPL and LGPL Debian packages:**
   - a release step that runs `apt-get source` for every package in the
     runtime image, with exact versions from `dpkg-query`, and attaches the
     tarball to the GitHub Release (a few hundred MB per release, or once
     per base image change);
   - the minimum alternative is a written offer in `/licenses/SOURCES.md`
     and THIRD_PARTY_NOTICES: name, contact address, and the exact package
     versions on `snapshot.debian.org`, valid for 3 years from each
     release.

Estimate 1 day (notices, the build steps, the release step).

### L2 · Medium · Privacy statement

**Evidence:**
- There's no PRIVACY.md and no privacy page on the site.
- SECURITY.md §6 lists the network destinations, but misses:
  - **Docker Hub** (`postgres`, `redis`, `chromadb` images; the installer's
    `busybox` GPU check);
  - the **MiniLM check on every start** (P3);
  - that every destination sees the user's **IP address** (and Hugging
    Face a library user-agent).

**What does leave the computer (verified):**

| To | When | What |
|---|---|---|
| GitHub (`github.com`, `objects.githubusercontent.com`) | install, `vcm update` | downloads; GitHub sees IP and user-agent |
| GHCR (`ghcr.io`) and Docker Hub | install, update | image pulls |
| Hugging Face | first use of each model, and (today) MiniLM at each start | model files; IP; no token (`HF_HUB_DISABLE_IMPLICIT_TOKEN=1`) |
| `raw.githubusercontent.com` | first use of a Google Font from the library | the font's path at a pinned commit |
| Google Gemini (`generativelanguage.googleapis.com`) | **only with a key you add** | caption text, up to 25 lines per batch, and for Search answers up to 6 captions plus the question; **never video or audio** |
| Nothing else | | no telemetry (`NEXT_TELEMETRY_DISABLED=1`), no crash reports, no accounts |

**Fix (phase 2):**
- **`PRIVACY.md`** (short), in this order:
  - the app has no servers of its own, and the developer receives nothing;
  - the table above;
  - the Gemini paragraph (L3);
  - the website: GitHub Pages hosting (GitHub logs IPs, under GitHub's
    privacy statement), and GoatCounter, which counts visits without
    cookies or stored IPs and shows events only as totals;
  - contact.
- **A `privacy.html` page on the site**, in the same design, linked from
  the footer.
- **Update SECURITY.md §6** with Docker Hub and P3.

### L3 · Medium · Gemini's terms aren't passed on to users

**Evidence:**
- Gemini API Additional Terms, effective 2026-03-23, updated 2026-04-28:
  - **Free (unpaid) keys:** Google uses prompts and responses to improve
    its products, and **human reviewers may read them**. "Do not submit
    sensitive, confidential, or personal information to the Unpaid
    Services."
  - **Paid keys:** not used for training; logged only to detect policy
    abuse.
  - **18+:** "You must be 18 years of age or older to use the APIs."
  - **EEA, Switzerland, UK:** "You may use only Paid Services when making
    API Clients available to users in the European Economic Area"
    (likewise Switzerland and the UK).
- The README and the Settings text say caption text goes to Google. Neither
  mentions the free-tier use, human review, or the age limit.

Users bring their own key, so they are Google's customer under these terms.
The app should still tell them before they paste one.

**Fix:**
- One line under the key field in Settings, and the same in the README and
  PRIVACY.md: "With a free key, Google may use the caption text to improve
  its products, and people at Google may read it. Use a paid key, or leave
  this empty, for anything private. Gemini requires you to be 18 or over."
- A link to the terms.
- No change to behaviour.

### L4 · Low · Warranty and rights

**Evidence:** the MIT LICENSE disclaims warranty, but nothing a user reads
says so.

**Fix:**
- **README "Licence" section and the site footer:** "Provided as is, with
  no warranty (MIT). Only process videos you have the right to use;
  captions and translations can be wrong, so check them before
  publishing."
- **The first-run screen or Settings → About:** one short line.

### L5 · Info · India's DPDP Act, 2023

**"We collect no personal data on any server":**
- **True of Tanush:** there are no servers. The app sends nothing to the
  developer, and the developer can't see users' videos, captions or
  settings.
- **Not true of third parties**, as L2 lists. Each sees IP addresses under
  its own terms; GoatCounter says it stores none. Say "we" (the project),
  not "nothing leaves your computer".

**Who the Act applies to:**
- **Users processing their own videos:** within the Act's exemption for
  personal or domestic purposes (s. 3(c)(i)). A business using the app on
  other people's videos is the data fiduciary for that, not Tanush; the
  privacy page should say so in one line.
- **The website:** GoatCounter collects no cookies and stores no IPs or
  personal identifiers, by its own description. GitHub is the controller
  of its server logs. With the privacy page (L2) this is low risk.
- **Timing:** the DPDP Rules are being phased in; re-check when the
  obligations take effect.

## 6. Backup and monitoring

### M1 · Medium · Model availability

**Evidence (Hugging Face API, today):**

| Model | Repo | Pinned? | Licence | Risk |
|---|---|---|---|---|
| Whisper small | `Systran/faster-whisper-small` | **no** (faster-whisper resolves the name) | MIT | low, a large org; but unpinned and unhashed |
| Whisper large-v3 | `Systran/faster-whisper-large-v3` | **no** | MIT | as above |
| Whisper large-v3-turbo | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` | **no** | MIT | **already moved**: the API now 307-redirects to `dropbox-dash/faster-whisper-large-v3-turbo`. It works through the redirect today; another move or a deletion breaks turbo for new installs |
| M2M100 1.2B / 418M | `jncraton/m2m100_*-ct2-int8` | yes, a commit | MIT | **one person's account**, 658 and 1,710 downloads; the most fragile |
| Hinglish (Apex) | `Oriserve/Whisper-Hindi2Hinglish-Apex` | yes, commit and sha256 | Apache-2.0 | a company repo |
| IndicXlit | `ai4bharat/IndicXlit` | yes, commit and sha256 | MIT | a research-lab repo |
| MiniLM | `sentence-transformers/all-MiniLM-L6-v2` | **no** (P3) | Apache-2.0 | low |

A deletion breaks the feature for new installs and for anyone choosing a
model they haven't downloaded yet. Downloaded models keep working.

**Proposed fallback:**
1. **Pin and hash everything:** Whisper (all three), M2M100 and MiniLM get
   a commit and a sha256, checked after download as Apex is. One table,
   `model_store.SOURCES`.
2. **A mirror you control:** a Hugging Face organisation (e.g.
   `videocaptionmaker`) holding a copy of each repo at its pinned commit.
   - The licences allow this: MIT and Apache-2.0 permit redistribution if
     the LICENSE (and Apache NOTICE, if any) is kept, plus a line saying it
     is an unmodified copy of `<repo>@<commit>`.
   - Hugging Face is the right place: GitHub release assets cap a file at
     2 GB, and large-v3's `model.bin` is 3.1 GB.
   - Cost: free, ~10 GB.
3. **Switching:** `model_store` tries the original repo first, then the
   mirror, on 404, 401 or a moved repo. The sha256 has to match either way,
   so a mirror can never serve different weights.
   - No setting and no update needed. The video shows the same download
     progress either way.
   - The weekly workflow (M2) checks both.

Estimate 1 day, plus Tanush creating the organisation and uploading (or I
script the upload for you to run with your token).

### M2 · Medium · A weekly "the release still works" workflow

**Proposal:** `.github/workflows/weekly-check.yml`, run Mondays 06:00 UTC
and by hand. Permissions: `contents: read`, `issues: write`. No secrets. Jobs:
1. **Release assets:** download `install.sh`, `install.ps1`, `vcm`,
   `vcm.ps1`, `vcm.cmd`, both compose files and `SHA256SUMS` from
   `releases/latest/download/`, then `sha256sum -c`.
2. **Images:** anonymous `docker manifest inspect` of
   `backend:{latest,X.Y.Z}-{cpu,cuda}` and `frontend:{latest,X.Y.Z}`. Plus
   the pinned service images (postgres, redis, chromadb) and `busybox:1.37`.
   - A manifest proves an image is pullable without downloading GBs.
   - One real `docker pull` of `frontend:latest` (230 MB) proves anonymous
     access end to end.
3. **Models:** for each entry in `model_store.SOURCES` (M1), a `HEAD` of
   `https://huggingface.co/<repo>/resolve/<commit>/<file>` for every file,
   the size compared, then the same for the mirror. A redirect is reported
   as a warning (it would have caught the turbo move).
4. **Dependencies still install:**
   - `pip install --dry-run -c constraints.txt .` against PyPI and the
     PyTorch CPU index;
   - `npm ci --ignore-scripts --dry-run` for the frontend;
   - catches yanked or deleted pins.
5. **Vulnerabilities:** Trivy on `backend:latest-cpu` and
   `frontend:latest`, reporting **new fixable** critical and high.
6. **Site:** `curl -f` of the landing page.

**On failure:** `gh issue create` with the label `weekly-check` and the
failed job's summary. If an open issue with that label already exists, it
comments there instead, so there's one issue per problem, not one per week.

Estimate ½ day.

### M3 · Low · `vcm backup` and `vcm restore` (ROADMAP)

**Proposal**, wrapping the procedure tested on 2026-10-14 (DATABASE.md §7):

**`vcm backup [folder]`:**
1. Check the free space against the media volume's size.
2. Stop the frontend, worker and backend.
3. `pg_dump -Fc`.
4. `tar` of `vcm_media`.
5. Copy `.env` (needed to read the database).
6. Write a `manifest.json` with the app version, the Alembic revision,
   dates and file sizes.
7. Start again and print the folder, its size and a reminder that it holds
   secrets.
8. Downtime is roughly 15 s plus the tar time.

**`vcm restore <folder>`:**
1. Read the manifest, and refuse if its Alembic revision is newer than the
   install's.
2. Ask for typed confirmation, since it replaces the current library.
3. Stop, `pg_restore --clean --if-exists`, replace `vcm_media`, start.
4. Re-index search: needs the ROADMAP re-index command. Until then, say
   "Search finds restored videos after Redo".

**Both shells:** `install/vcm` (bash) and `install/vcm.ps1`. Never the dev
stack, enforced by the fixed project name `vcm`.

**Tests:** a round trip on a throwaway project (as on 2026-10-14) on Windows
and Linux, a refused newer dump, a full disk, and an interrupted backup
leaving no partial folder.

**Estimate:**
- backup and restore: **2 days**, including docs and tests;
- the library-wide re-index command (ROADMAP): **+½ day**.

### M4 · Low · Bug reports: templates and `vcm doctor`

**Proposal:**
- **`.github/ISSUE_TEMPLATE/bug.yml`** (a form):
  - what happened and what was expected;
  - steps;
  - the version (`vcm doctor` prints it);
  - OS;
  - GPU or CPU;
  - "attach the file from `vcm doctor`".
- **`feature.yml`.**
- **`config.yml`:** turns off blank issues and links "Report a security
  problem" to private reporting.

**`vcm doctor`** (bash and PowerShell) writes `vcm-doctor-<date>.txt` in
the current folder:
- app version, variant and port: read from `.env` **by an allow-list of
  keys** (`VCM_VERSION`, `VCM_VARIANT`, `VCM_PORT`), never the whole file;
- OS and version, Docker and Compose versions;
- `docker info`: CPUs, memory, disk;
- the GPU: `nvidia-smi -L` and the driver;
- `vcm status` and the image digests;
- free disk;
- `/api/health`;
- `/api/system`, which has no secrets: it reports only
  `gemini_configured`;
- the last 300 log lines of each service.

Redaction before writing:
- `token=…`, `Authorization`, anything matching an API-key pattern, and
  email addresses;
- **video filenames** in logs, replaced with `<video>`, because a filename
  can be personal.

It ends with: "Review vcm-doctor-….txt before attaching it." Estimate 1 day
with tests on both shells.

### M5 · Low · Site uptime monitor (free)

UptimeRobot, free plan:
1. Sign up at https://uptimerobot.com.
2. **Add New Monitor:** type **Keyword**. URL
   `https://tanush1206.github.io/Video-Caption-Maker/`, keyword
   `Private, offline AI captions`, alert when **not present**, interval
   5 minutes.
   - A keyword monitor also catches a deploy that serves the wrong page.
   - It fetches HTML only and runs no scripts, so it doesn't count in
     GoatCounter.
3. **A second HTTP(s) monitor** for
   `https://github.com/Tanush1206/Video-Caption-Maker/releases/latest/download/install.ps1`.
   A 302 to the asset counts as up.
4. Alert contact: your email. Optionally the mobile app for push alerts.
5. Optional: a free public status page, linked from the README.

---

## What only you can do

- [ ] Choose which findings to fix in phase 2. Recommended at minimum: S1,
      S2, L1 (High), then S3–S7, P1–P3, U1–U3, L2, L3.
- [ ] GitHub, §1.12:
  - [ ] Dependabot alerts and security updates;
  - [ ] secret scanning and push protection;
  - [ ] CodeQL;
  - [ ] rulesets for `main` and the `v*` tags;
  - [ ] Actions defaults and fork approval;
  - [ ] GHCR package access;
  - [ ] 2FA with a passkey or hardware key.
- [ ] Search Console: add the URL-prefix property and send me the
      verification tag or file; after the deploy, Verify, submit the
      sitemap and request indexing.
- [ ] Bing Webmaster Tools: Import from Google Search Console.
- [ ] Decide on SEO3: create `Tanush1206.github.io` for a root robots.txt,
      or leave SEO at 92.
- [ ] After SEO1 is live:
  - [ ] check the preview in LinkedIn's Post Inspector (needs your login);
  - [ ] share the link to yourself on WhatsApp.
- [ ] UptimeRobot: create the two monitors (M5).
- [ ] M1:
  - [ ] create a Hugging Face organisation for the model mirror;
  - [ ] upload, or run the upload script I write, with your HF token. Never
        paste the token into the repo or chat.
- [ ] L1: give a contact address for the GPL source offer (an email you're
      happy to publish for 3 years), and say whether to attach the Debian
      source tarball to each release or rely on the written offer.
- [ ] L2/L5: give a contact email for PRIVACY.md.
- [ ] L1/L3/L5: if anything matters commercially, have a lawyer check it.
      This audit is not legal advice.
- [ ] Run the usability test (§4.2) with 1–3 people who have never seen the
      app.
