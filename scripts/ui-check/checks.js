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

  // An address that matches no route gets the app's own 404 page, with a way
  // back, instead of Next's bare default.
  async "not-found"(browser, base) {
    const page = await browser.newPage();
    const response = await page.goto(`${base}/no-such-page-${Date.now()}`, { waitUntil: "networkidle" });
    ok("not-found: status 404", response.status() === 404, String(response.status()));
    ok("not-found: the app's own page", await page.getByRole("heading", { name: "Page not found" }).isVisible());
    const back = page.getByRole("link", { name: "Back to your videos" });
    ok("not-found: links back to the videos", (await back.getAttribute("href")) === "/dashboard");
    await back.click();
    await page.waitForURL(/\/dashboard$/);
    ok("not-found: the link works", page.url().endsWith("/dashboard"));
    await page.close();
  },

  // The failed screen's "Retry with small model": sets the speech model to
  // small through Settings' own API, then queues the video again, in that
  // order. Read-only: the video is shown as failed and both writes are
  // answered here, so no real setting or video changes.
  async "retry-small"(browser, base) {
    const page = await browser.newPage();
    const listing = await (await page.request.get(`${base}/api/videos?limit=1`)).json();
    const video = listing.items[0];
    if (!video) throw new Error("needs at least one video");
    const writes = [];

    await page.route("**/api/system", async (route) => {
      const info = await (await route.fetch()).json();
      info.whisper = { ...(info.whisper ?? { device: "cpu", compute_type: "int8", source: "auto" }), model: "large-v3-turbo" };
      await route.fulfill({ json: info });
    });
    await page.route(`**/api/videos/${video.id}`, async (route) => {
      const body = await (await route.fetch()).json();
      await route.fulfill({
        json: { ...body, status: "failed", stage: null, error_message: "Ran out of memory while transcribing." },
      });
    });
    await page.route("**/api/system/settings", async (route) => {
      writes.push(`${route.request().method()} settings ${route.request().postData()}`);
      const info = await (await page.request.get(`${base}/api/system`)).json();
      await route.fulfill({ json: { ...info, whisper_choice: "small" } });
    });
    await page.route(`**/api/videos/${video.id}/transcribe`, async (route) => {
      writes.push(`${route.request().method()} transcribe`);
      await route.fulfill({ json: { ...video, status: "pending", stage: null, progress: 0 } });
    });

    await page.goto(`${base}/editor/${video.id}`, { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "Retry with small model" });
    ok("retry-small: offered on the failed screen", await button.isVisible());
    await button.click();
    await page.waitForTimeout(1000);
    ok(
      "retry-small: model set to small, then the video retried",
      writes.length === 2 && writes[0] === 'PATCH settings {"whisper_model":"small"}' && writes[1] === "POST transcribe",
      writes.join(" → ")
    );
    await page.close();
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
