# UI checks

Browser checks run against a **running** VideoCaptionMaker: an install, or a
dev server. Playwright (Chromium) and axe-core, pinned in `package.json`.

```bash
cd scripts/ui-check
npm ci
npx playwright install chromium        # once per machine

node shoot.js  <base> <outDir> /dashboard /search /settings   # 375/1440 × light/dark; fails on console errors or overflow
node axe.js    <base> /dashboard /search /settings            # WCAG 2 A/AA; fails on any violation
node checks.js <base> theme not-found                         # named behaviour checks
VCM_CHECK_VIDEO=<id> node checks.js <base> caption-drag       # editor checks: change that video's style
node flow.js   <base> <videoIdToDelete> <videoIdToExport>     # deletes a video: test installs only
VCM_PARITY_VIDEO=<id> node checks.js <base> style-parity        # preview vs burn, 20 style options (below)
```

`<base>` is the app's address, e.g. `http://localhost:3000`. Run `flow.js` at
both `localhost` and `127.0.0.1` to exercise the request guard.

On Windows Git Bash, set `MSYS_NO_PATHCONV=1` first, or the page paths
(`/settings`) are rewritten into Windows paths.

Screenshots are written to the folder you name; keep them out of the repo.
The editor checks (`style-sliders`, `caption-drag`, `caption-handle`, `caption-width`, `caption-snap`, `caption-safe-area`,
`caption-keyboard`, `caption-size`, `caption-wrap`) need a completed video
with captions and reset its caption style before and after; run them on the
dev stack or a test install. `node checks.js <base>` with no check names
lists them all.

See docs/TESTING.md for when each check is required.

`style-parity` (v1.3.0) needs a dev video with captions whose file is a flat
colour, so that whatever differs from the frame is the caption: transcribe a
short clip with speech on the dev stack, then replace its file with
`ffmpeg -f lavfi -i color=c=0x808080:s=1920x1080:r=25:d=<length> -f lavfi -i
anullsrc -shortest -c:v libx264 -pix_fmt yuv420p -c:a aac <its storage path>`
inside the backend container. `VCM_PARITY_ONLY="default,italic"` runs some
options; `VCM_PARITY_SAVE=1` keeps both frames in the backend's `/tmp`.

