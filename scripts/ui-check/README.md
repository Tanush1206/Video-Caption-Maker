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
node flow.js   <base> <videoIdToDelete> <videoIdToExport>     # deletes a video: test installs only
```

`<base>` is the app's address, e.g. `http://localhost:3000`. Run `flow.js` at
both `localhost` and `127.0.0.1` to exercise the request guard.

On Windows Git Bash, set `MSYS_NO_PATHCONV=1` first, or the page paths
(`/settings`) are rewritten into Windows paths.

Screenshots are written to the folder you name; keep them out of the repo.
See docs/TESTING.md for when each check is required.
