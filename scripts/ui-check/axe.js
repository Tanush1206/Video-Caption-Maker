// axe-core WCAG 2 A/AA scan of each page, in light and dark.
// Fails if any violation is found.
//
//   node axe.js <baseUrl> <path> [path ...]
const { chromium } = require("playwright");
const { AxeBuilder } = require("@axe-core/playwright");

const [base, ...paths] = process.argv.slice(2);
if (!base || paths.length === 0) {
  console.error("usage: node axe.js <baseUrl> <path> [path ...]");
  process.exit(2);
}

(async () => {
  const browser = await chromium.launch();
  let violations = 0;
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme: theme });
    await context.addInitScript((t) => localStorage.setItem("vcm-theme", t), theme);
    const page = await context.newPage();
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      for (const v of result.violations) {
        violations += 1;
        const where = v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ");
        console.log(`${theme} ${p} [${v.impact}] ${v.id}: ${v.nodes.length}x — ${where}`);
      }
    }
    await context.close();
  }
  await browser.close();
  console.log(violations ? `${violations} violation(s)` : "axe: 0 violations");
  process.exit(violations ? 1 : 0);
})();
