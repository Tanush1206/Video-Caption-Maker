// Screenshots of each page at phone (375) and desktop (1440) width, in light
// and dark. Fails on a console error, a page error or horizontal overflow.
//
//   node shoot.js <baseUrl> <outDir> <path> [path ...]
//   node shoot.js http://localhost:3000 out /dashboard /search /settings
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const [base, outDir, ...paths] = process.argv.slice(2);
if (!base || !outDir || paths.length === 0) {
  console.error("usage: node shoot.js <baseUrl> <outDir> <path> [path ...]");
  process.exit(2);
}
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 375, height: 812 } };

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  const problems = [];
  for (const theme of ["light", "dark"]) {
    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      const context = await browser.newContext({ viewport, colorScheme: theme });
      await context.addInitScript((t) => localStorage.setItem("vcm-theme", t), theme);
      const page = await context.newPage();
      page.on("pageerror", (e) => problems.push(`${theme}/${name} pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") problems.push(`${theme}/${name} console: ${m.text().slice(0, 200)}`);
      });
      for (const p of paths) {
        await page.goto(base + p, { waitUntil: "networkidle" }).catch((e) => problems.push(`${p}: ${e.message}`));
        await page.waitForTimeout(1000);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        if (overflow > 1) problems.push(`${theme}/${name} ${p}: horizontal overflow ${overflow}px`);
        const file = `${p.replace(/\//g, "_") || "_root"}-${name}-${theme}.png`;
        await page.screenshot({ path: path.join(outDir, file), fullPage: true });
      }
      await context.close();
    }
  }
  await browser.close();
  console.log(problems.length ? problems.join("\n") : `ok: ${paths.length} page(s) × 2 widths × 2 themes`);
  process.exit(problems.length ? 1 : 0);
})();
