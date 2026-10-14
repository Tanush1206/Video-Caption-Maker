// Named browser checks for specific UI behaviour. Each prints PASS/FAIL lines;
// the process fails if any check does.
//
//   node checks.js <baseUrl> <check> [check ...]
//   node checks.js http://localhost:3000 theme not-found
//
// Checks that change data say so below; run those against a test install.
const { chromium } = require("playwright");

const results = [];
const ok = (name, pass, detail = "") => results.push(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ": " + detail : ""}`);
const isDark = (page) => page.evaluate(() => document.documentElement.classList.contains("dark"));
const stored = (page) => page.evaluate(() => localStorage.getItem("vcm-theme"));

const CHECKS = {
  // Settings → Interface theme offers Light, Dark and System. System stores
  // nothing, follows the OS, and follows it live when the OS changes.
  async theme(browser, base) {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const group = page.getByRole("radiogroup", { name: "Interface theme" });
    const radio = (name) => group.getByRole("radio", { name });

    ok("theme: three options", (await group.getByRole("radio").count()) === 3);
    ok("theme: System is the default", (await radio("System").getAttribute("aria-checked")) === "true");
    ok("theme: default follows a dark OS", await isDark(page));

    await radio("Light").click();
    ok("theme: Light applies and is stored", !(await isDark(page)) && (await stored(page)) === "light");

    await radio("System").click();
    ok("theme: System clears the stored choice", (await stored(page)) === null);
    ok("theme: System follows the OS (dark)", await isDark(page));
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForTimeout(300);
    ok("theme: System follows an OS change live", !(await isDark(page)));

    await page.reload({ waitUntil: "networkidle" });
    ok("theme: System survives a reload", (await radio("System").getAttribute("aria-checked")) === "true" && !(await isDark(page)));

    await radio("Dark").click();
    await page.emulateMedia({ colorScheme: "light" });
    ok("theme: an explicit Dark ignores the OS", await isDark(page));
    await radio("System").click();
    await context.close();
  },
};

(async () => {
  const [base, ...names] = process.argv.slice(2);
  const unknown = names.filter((n) => !CHECKS[n]);
  if (!base || names.length === 0 || unknown.length) {
    console.error(`usage: node checks.js <baseUrl> <check> [check ...]\nchecks: ${Object.keys(CHECKS).join(", ")}`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  for (const name of names) {
    try {
      await CHECKS[name](browser, base, process.argv);
    } catch (error) {
      ok(name, false, error.message.split("\n")[0]);
    }
  }
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
