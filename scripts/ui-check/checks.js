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

// The editor checks below need a completed video with captions, and they
// change its caption style (reset to defaults before and after): run them on
// the dev stack or a test install. VCM_CHECK_VIDEO picks the video; otherwise
// the newest completed one is used.
async function editorVideo(page, base) {
  if (process.env.VCM_CHECK_VIDEO) return Number(process.env.VCM_CHECK_VIDEO);
  const listing = await (await page.request.get(`${base}/api/videos?limit=50`)).json();
  const video = listing.items.find((v) => v.status === "completed");
  if (!video) throw new Error("needs a completed video");
  return video.id;
}

/** Open the editor on `id` with the default style and a caption on screen. */
async function openEditor(page, base, id) {
  await page.request.delete(`${base}/api/videos/${id}/style`);
  await page.goto(`${base}/editor/${id}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
  const captions = await (await page.request.get(`${base}/api/videos/${id}/captions`)).json();
  const first = captions.items.find((c) => c.end_ms - c.start_ms > 1000) ?? captions.items[0];
  await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, (first.start_ms + first.end_ms) / 2000);
  await page.locator("[data-caption-text]").waitFor();
}

const styleOf = async (page, base, id) => (await page.request.get(`${base}/api/videos/${id}/style`)).json();

/** Geometry of the frame and the caption text, in page pixels. */
const captionGeometry = (page) =>
  page.evaluate(() => {
    const text = document.querySelector("[data-caption-text]");
    const frame = document.querySelector("video").parentElement.getBoundingClientRect();
    const r = text?.getBoundingClientRect();
    return {
      frame: { x: frame.x, y: frame.y, w: frame.width, h: frame.height },
      text: r ? { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 } : null,
    };
  });

/** Everything about the preview a style slider can change. */
const previewSignature = (page) =>
  page.evaluate(() => {
    const text = document.querySelector("[data-caption-text]");
    const s = getComputedStyle(text);
    const r = text.getBoundingClientRect();
    const b = getComputedStyle(text.parentElement);
    return [s.fontSize, s.letterSpacing, s.webkitTextStrokeWidth, s.textShadow, s.backgroundColor, s.padding, r.x, r.y, r.width, b.padding, b.maxWidth].join("|");
  });

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

  // The editor's caption-language select (used by Redo) offers all five
  // languages, enabled, with or without a Gemini key: translation is local.
  async "editor-languages"(browser, base) {
    const page = await browser.newPage();
    const listing = await (await page.request.get(`${base}/api/videos?limit=1`)).json();
    const video = listing.items[0];
    if (!video) throw new Error("needs at least one video");
    // Shown as completed whatever its real state, so any install will do.
    await page.route(`**/api/videos/${video.id}`, async (route) => {
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { ...body, status: "completed", stage: null, error_message: null } });
    });
    // The select sits in the caption list, which needs a caption to render.
    await page.route(`**/api/videos/${video.id}/captions`, (route) =>
      route.fulfill({
        json: {
          total: 1,
          items: [{
            id: 1, video_id: video.id, sequence: 0, start_ms: 0, end_ms: 1000, text: "Hello",
            confidence: -0.2, override_color: null, override_bold: null, override_scale: null,
          }],
        },
      })
    );
    await page.goto(`${base}/editor/${video.id}`, { waitUntil: "networkidle" });
    const select = page.locator("label", { hasText: "Captions" }).locator("select").first();
    const options = await select.locator("option").evaluateAll((els) => els.map((o) => [o.value, o.disabled]));
    const values = options.map(([value]) => value).join(",");
    ok("editor-languages: all six choices", values === "same,en,hi,fr,de,nl", values);
    ok("editor-languages: none disabled", options.every(([, disabled]) => !disabled));
    await page.close();
  },

  // Every style-panel slider, by drag, click and arrow keys: the value moves
  // with the pointer (never snapping back), the label shows the value, the
  // preview changes, and the saved style matches after a reload.
  // Changes data: see editorVideo.
  async "style-sliders"(browser, base) {
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const id = await editorVideo(page, base);
      await openEditor(page, base, id);
      const at = `style-sliders@${width}`;
      for (const tab of ["Typography", "Appearance", "Position"]) {
        await page.getByRole("radio", { name: tab }).click();
        const sliders = page.locator('#caption-style input[type="range"]:visible');
        for (let i = 0; i < (await sliders.count()); i++) {
          const el = sliders.nth(i);
          // Greyed out while it has no effect (Padding without a box).
          if (await el.isDisabled()) continue;
          await el.scrollIntoViewIfNeeded();
          const label = el.locator("xpath=ancestor::label[1]");
          const name = (await label.innerText()).split(" —")[0];
          const [min, max, step] = ["min", "max", "step"].map(async (a) => Number(await el.getAttribute(a)));
          const lo = await min, hi = await max, st = (await step) || 1;
          const value = async () => Number(await el.inputValue());
          const shown = async () => Number((await label.innerText()).match(/— (-?[\d.]+)/)?.[1]);

          // Drag the thumb from the minimum to the right, sampling as it goes.
          await el.focus(); await page.keyboard.press("Home");
          let box = await el.boundingBox();
          const y = box.y + box.height / 2;
          await page.mouse.move(box.x + 8, y); await page.mouse.down();
          const samples = [];
          for (let k = 1; k <= 8; k++) {
            await page.mouse.move(box.x + 8 + ((box.width - 16) * k) / 10, y);
            await page.waitForTimeout(40);
            samples.push(await value());
          }
          await page.mouse.up();
          const monotonic = samples.every((v, k) => k === 0 || v >= samples[k - 1]) && samples.at(-1) > lo;
          ok(`${at}: ${tab}/${name} drag follows the pointer`, monotonic, samples.join(","));
          // A control appearing or vanishing above it must not move the
          // slider out from under a pointer that is still dragging it.
          const moved = await el.boundingBox();
          ok(`${at}: ${tab}/${name} stays put while dragged`, Math.abs(moved.x - box.x) < 1 && Math.abs(moved.y - box.y) < 1, `${Math.round(box.x)},${Math.round(box.y)} → ${Math.round(moved.x)},${Math.round(moved.y)}`);

          // Click a point on the track, then step it with the keyboard.
          box = await el.boundingBox();
          await page.mouse.click(box.x + 8 + (box.width - 16) * 0.25, box.y + box.height / 2);
          const clicked = await value();
          const expected = lo + (hi - lo) * 0.25;
          ok(`${at}: ${tab}/${name} click sets the value`, Math.abs(clicked - expected) <= (hi - lo) * 0.03 + st, `${clicked} vs ${expected}`);
          const before = await previewSignature(page);
          await el.focus(); await page.keyboard.press("ArrowRight");
          const keyed = await value();
          ok(`${at}: ${tab}/${name} arrow key steps by ${st}`, Math.abs(keyed - clicked - st) < 1e-9, `${clicked} → ${keyed}`);
          ok(`${at}: ${tab}/${name} label shows the value`, (await shown()) === keyed, `${await shown()} vs ${keyed}`);
          // Live: the overlay redraws from the cache a render later, well
          // inside half a second.
          const updated = await page.waitForFunction((b) => {
            const t = document.querySelector("[data-caption-text]"); const s = getComputedStyle(t); const r = t.getBoundingClientRect();
            const p = getComputedStyle(t.parentElement);
            return [s.fontSize, s.letterSpacing, s.webkitTextStrokeWidth, s.textShadow, s.backgroundColor, s.padding, r.x, r.y, r.width, p.padding, p.maxWidth].join("|") !== b;
          }, before, { timeout: 500 }).then(() => true, () => false);
          ok(`${at}: ${tab}/${name} preview updates`, updated);
        }
      }
      await page.waitForTimeout(1000);
      const saved = await styleOf(page, base, id);
      await page.reload({ waitUntil: "networkidle" });
      const reloaded = await styleOf(page, base, id);
      ok(`${at}: saved style survives a reload`, JSON.stringify(saved) === JSON.stringify(reloaded));
      for (const [name, field, scale] of [["Size", "font_size", 1], ["Opacity", "box_opacity", 100], ["Outline", "outline_width", 1]]) {
        const tab = name === "Size" ? "Typography" : "Appearance";
        await page.getByRole("radio", { name: tab }).click();
        const shownValue = Number(await page.getByLabel(new RegExp(`^${name} —`)).inputValue());
        ok(`${at}: ${name} after reload shows the saved value`, Math.round(saved[field] * scale) === shownValue, `${shownValue} vs ${saved[field]}`);
      }
      await page.request.delete(`${base}/api/videos/${id}/style`);
      await page.close();
    }
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
