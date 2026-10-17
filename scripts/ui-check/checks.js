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
  await waitForCaption(page, first.text);
}

/**
 * Until the overlay shows `text`. Right after a seek it still shows the
 * caption from where the playhead was, and measuring that one (a different
 * width) makes every geometry check wrong.
 */
const waitForCaption = (page, text) =>
  page.waitForFunction((t) => document.querySelector("[data-caption-text]")?.textContent === t, text);

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
    const b = getComputedStyle(text.closest("[data-caption-box]"));
    return [s.fontSize, s.letterSpacing, s.webkitTextStrokeWidth, s.textShadow, s.backgroundColor, s.padding, r.x, r.y, r.width, b.padding, b.maxWidth].join("|");
  });

/** A pointer that can be a mouse or a finger, driving one drag gesture. */
async function pointer(page, kind) {
  if (kind === "mouse") {
    return {
      down: async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); },
      move: (x, y) => page.mouse.move(x, y, { steps: 4 }),
      up: () => page.mouse.up(),
    };
  }
  const cdp = await page.context().newCDPSession(page);
  let last = [0, 0];
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  return {
    down: async (x, y) => { last = [x, y]; await touch("touchStart", [{ x, y }]); },
    move: async (x, y) => {
      const [x0, y0] = last;
      for (let k = 1; k <= 4; k++) await touch("touchMove", [{ x: x0 + ((x - x0) * k) / 4, y: y0 + ((y - y0) * k) / 4 }]);
      last = [x, y];
    },
    up: () => touch("touchEnd", []),
  };
}

const near = (a, b, tolerance = 1.5) => Math.abs(a - b) <= tolerance;

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

  // The editor's caption-language picker (used by Redo): every language the
  // API serves, enabled, each with its own name and its English one; search
  // by either (accents optional), keyboard to choose. Read-only: the video
  // and its captions are answered here, and Redo is never pressed.
  async "editor-languages"(browser, base) {
    const page = await browser.newPage();
    const listing = await (await page.request.get(`${base}/api/videos?limit=1`)).json();
    const video = listing.items[0];
    if (!video) throw new Error("needs at least one video");
    const served = (await (await page.request.get(`${base}/api/videos/languages`)).json()).caption;
    // Shown as completed whatever its real state, so any install will do.
    await page.route(`**/api/videos/${video.id}`, async (route) => {
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { ...body, status: "completed", stage: null, error_message: null, caption_language: "same" } });
    });
    // The picker sits in the caption list, which needs a caption to render.
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
    const trigger = page.getByRole("button", { name: /^Caption language:/ });
    ok("editor-languages: picker shown", await trigger.isVisible());
    await trigger.click();
    const options = page.getByRole("listbox", { name: "Caption language" }).getByRole("option");
    const texts = await options.allInnerTexts();
    ok("editor-languages: every served language", texts.length === served.length, `${texts.length} vs ${served.length}`);
    const both = served.filter((o) => o.native && o.native !== o.label).every((o) => texts.some((t) => t.includes(o.native) && t.includes(o.label)));
    ok("editor-languages: native and English names", both);
    const search = page.getByRole("combobox", { name: "Search caption languages" });
    ok("editor-languages: search has focus on open", await search.evaluate((e) => e === document.activeElement));
    await search.fill("rus");
    ok("editor-languages: search by English name", (await options.allInnerTexts()).join("|").includes("Русский") && (await options.count()) === 1);
    await search.fill("espanol");
    ok("editor-languages: search ignores accents", (await options.count()) === 1 && (await options.first().innerText()).includes("Español"));
    await search.fill("বাংলা");
    ok("editor-languages: search by native name", (await options.count()) === 1);
    await search.fill("zzz");
    ok("editor-languages: says when nothing matches", (await page.getByText("No language matches").count()) === 1);
    await search.fill("ta");
    await page.keyboard.press("Enter");
    ok("editor-languages: Enter chooses and closes", (await trigger.getAttribute("aria-expanded")) === "false" && (await trigger.getAttribute("aria-label")).includes("தமிழ்"));
    ok("editor-languages: focus returns to the picker", await trigger.evaluate((e) => e === document.activeElement));
    ok("editor-languages: Redo hint appears", await page.getByText("Press Redo to apply").isVisible());
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    ok("editor-languages: Escape closes", (await trigger.getAttribute("aria-expanded")) === "false");
    await trigger.click();
    await page.mouse.click(5, 5);
    ok("editor-languages: a click outside closes", (await trigger.getAttribute("aria-expanded")) === "false");
    await page.close();
  },

  // The upload's language step: one card per served language, searchable by
  // English name, own name or code; "Same as spoken" always there. Read-only:
  // a file is picked but never uploaded.
  async "language-step"(browser, base) {
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const at = `language-step@${width}`;
      const served = (await (await page.request.get(`${base}/api/videos/languages`)).json()).caption;
      await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').first().setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
      const group = page.getByRole("radiogroup", { name: "Caption into" });
      await group.waitFor();
      const cards = group.getByRole("radio");
      ok(`${at}: a card per served language`, (await cards.count()) === served.length, `${await cards.count()} vs ${served.length}`);
      const search = page.getByRole("searchbox", { name: "Search caption languages" });
      await search.fill("bengali");
      const shown = await group.locator("label").allInnerTexts();
      ok(`${at}: search by English name`, shown.length === 2 && shown[1].includes("বাংলা"), shown.join(" / "));
      await search.fill("Русский");
      ok(`${at}: search by native name`, (await cards.count()) === 2);
      await search.fill("ml");
      ok(`${at}: search by code`, (await group.locator("label").allInnerTexts()).some((t) => t.includes("മലയാളം")));
      await search.fill("klingon");
      ok(`${at}: only "Same as spoken" when nothing matches`, (await cards.count()) === 1);
      ok(`${at}: says nothing matches`, await page.getByRole("status").filter({ hasText: "No caption language matches" }).isVisible());
      await search.fill("tamil");
      await group.locator("label").nth(1).click();
      ok(`${at}: a found language can be chosen`, await group.getByRole("radio", { checked: true }).evaluate((e) => e.value === "ta"));
      await search.fill("");
      ok(`${at}: clearing the search shows them all`, (await cards.count()) === served.length);
      await page.close();
    }
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
          // Centred, not just "in view": on a phone the bottom of the
          // viewport is under the editor's fixed action bar.
          await el.evaluate((e) => e.scrollIntoView({ block: "center" }));
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
            const p = getComputedStyle(t.closest("[data-caption-box]"));
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

  // Dragging the caption on the video, by mouse and by touch, at 1440 and
  // 375: no jump on grab, follows the pointer, stays whole and inside the
  // frame however far it is dragged, saves on release where it was dropped,
  // and is in the same place after a reload. Changes data: see editorVideo.
  async "caption-drag"(browser, base) {
    for (const width of [1440, 375]) {
      for (const kind of ["mouse", "touch"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: kind === "touch" });
        const page = await context.newPage();
        const id = await editorVideo(page, base);
        await openEditor(page, base, id);
        const at = `caption-drag@${width}/${kind}`;
        const drag = await pointer(page, kind);
        await page.locator("[data-caption-text]").scrollIntoViewIfNeeded();
        const start = await captionGeometry(page);
        const { frame } = start;
        const size = { w: start.text.w, h: start.text.h };

        // Grab, then a small move: the caption moves exactly that far.
        await drag.down(start.text.cx, start.text.cy);
        await drag.move(start.text.cx + 12, start.text.cy - 12);
        await page.waitForTimeout(80);
        let now = await captionGeometry(page);
        ok(`${at}: no jump on grab`, near(now.text.cx - start.text.cx, 12) && near(now.text.cy - start.text.cy, -12), `${(now.text.cx - start.text.cx).toFixed(1)},${(now.text.cy - start.text.cy).toFixed(1)}`);

        // A move that stays inside the frame: the caption follows exactly.
        // Up by 30% of the frame, but never above the viewport: a pointer
        // cannot leave the window, and a portrait frame is taller than it.
        // Measured against the frame, so a page scroll doesn't count.
        // Nor so far that the caption's own top edge meets the frame's,
        // where the clamp (correctly) stops it.
        const dy = -Math.min(frame.h * 0.3, start.text.cy - 20, start.text.y - frame.y - 10);
        await drag.move(start.text.cx + 12, start.text.cy + dy);
        await page.waitForTimeout(80);
        now = await captionGeometry(page);
        const travelled = (now.text.cy - now.frame.y) - (start.text.cy - start.frame.y);
        const scrolled = now.frame.y - start.frame.y;
        ok(`${at}: follows the pointer`, near(travelled, dy - scrolled), `${travelled.toFixed(1)} vs ${(dy - scrolled).toFixed(1)}`);

        // Far past each edge in turn: the caption stays whole, its own size,
        // and inside the frame.
        for (const [name, x, y] of [["right", frame.x + frame.w * 3, now.text.cy], ["bottom", now.text.cx, frame.y + frame.h * 3], ["left", frame.x - frame.w * 2, now.text.cy], ["top", now.text.cx, frame.y - frame.h * 2]]) {
          await drag.move(x, y);
          await page.waitForTimeout(80);
          const g = await captionGeometry(page);
          const inside = g.text.x >= frame.x - 1 && g.text.y >= frame.y - 1 && g.text.x + g.text.w <= frame.x + frame.w + 1 && g.text.y + g.text.h <= frame.y + frame.h + 1;
          ok(`${at}: past the ${name} edge stays inside the frame`, inside, JSON.stringify(g.text));
          ok(`${at}: past the ${name} edge keeps its size`, near(g.text.w, size.w, 2) && near(g.text.h, size.h, 2), `${g.text.w.toFixed(0)}x${g.text.h.toFixed(0)} vs ${size.w.toFixed(0)}x${size.h.toFixed(0)}`);
        }

        // Back to a middle spot, release: no jump, and saved where it lies.
        const tx = frame.x + frame.w * 0.4, ty = frame.y + frame.h * 0.35;
        await drag.move(tx, ty);
        await page.waitForTimeout(80);
        const held = await captionGeometry(page);
        await drag.up();
        await page.waitForTimeout(200);
        const dropped = await captionGeometry(page);
        ok(`${at}: no jump on release`, near(dropped.text.cx, held.text.cx) && near(dropped.text.cy, held.text.cy));
        await page.waitForTimeout(800);
        const saved = await styleOf(page, base, id);
        const fx = (dropped.text.cx - frame.x) / frame.w, fy = (dropped.text.cy - frame.y) / frame.h;
        ok(`${at}: saved where it was dropped`, near(saved.pos_x, fx, 0.005) && near(saved.pos_y, fy, 0.005), `${saved.pos_x?.toFixed(3)},${saved.pos_y?.toFixed(3)} vs ${fx.toFixed(3)},${fy.toFixed(3)}`);
        ok(`${at}: a drag does not toggle playback`, await page.evaluate(() => document.querySelector("video").paused));

        const time = await page.evaluate(() => document.querySelector("video").currentTime);
        const shownText = dropped.text && (await page.evaluate(() => document.querySelector("[data-caption-text]").textContent));
        await page.reload({ waitUntil: "networkidle" });
        await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
        await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, time);
        await waitForCaption(page, shownText);
        const reloaded = await captionGeometry(page);
        const rx = (reloaded.text.cx - reloaded.frame.x) / reloaded.frame.w, ry = (reloaded.text.cy - reloaded.frame.y) / reloaded.frame.h;
        ok(`${at}: same place after a reload`, near(rx, fx, 0.004) && near(ry, fy, 0.004), `${rx.toFixed(3)},${ry.toFixed(3)} vs ${fx.toFixed(3)},${fy.toFixed(3)}`);
        await page.request.delete(`${base}/api/videos/${id}/style`);
        await context.close();
      }
    }
  },

  // The preview draws a caption at the size libass will burn it: libass makes
  // a face's whole cell (usWinAscent + usWinDescent) the font size, CSS makes
  // the em the font size, so the preview's font-size is size x scale / span
  // and its line-height is the span. Measured against the burn on dev: within
  // 1% in width for Liberation Sans, Poppins and Lato (Poppins Bold was 1.76x
  // before). Changes data: see editorVideo.
  async "caption-size"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    await openEditor(page, base, id);
    for (const font of ["sans", "poppins", "lato", "anton"]) {
      const style = await (await page.request.patch(`${base}/api/videos/${id}/style`, { data: { font_key: font, font_size: 80 } })).json();
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
      await page.locator("[data-caption-text]").waitFor();
      const got = await page.evaluate(() => {
        const t = document.querySelector("[data-caption-text]");
        const frame = document.querySelector("video").parentElement.getBoundingClientRect();
        const s = getComputedStyle(t);
        return { size: parseFloat(s.fontSize), line: parseFloat(s.lineHeight), frameH: frame.height };
      });
      const scale = got.frameH / style.reference_height;
      const expected = (style.font_size * scale) / style.font_win_span;
      ok(`caption-size: ${font} served a win span`, style.font_win_span > 1, String(style.font_win_span));
      ok(`caption-size: ${font} font-size = size x scale / span`, Math.abs(got.size - expected) < 0.05, `${got.size.toFixed(2)} vs ${expected.toFixed(2)}`);
      ok(`caption-size: ${font} line height = the libass cell`, Math.abs(got.line - style.font_size * scale) < 0.1, `${got.line.toFixed(2)} vs ${(style.font_size * scale).toFixed(2)}`);
    }
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.close();
  },

  // A caption that wraps breaks into lines of about the same width, as
  // libass's WrapStyle 0 does in the export (measured: 61% + 64% of the
  // frame there; the preview's greedy wrap was 86% + 38%). Changes data:
  // see editorVideo.
  async "caption-wrap"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    await openEditor(page, base, id);
    await page.request.patch(`${base}/api/videos/${id}/style`, { data: { font_size: 130 } });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    const captions = await (await page.request.get(`${base}/api/videos/${id}/captions`)).json();
    const long = captions.items.reduce((a, b) => (b.text.length > a.text.length ? b : a));
    await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, (long.start_ms + long.end_ms) / 2000);
    await waitForCaption(page, long.text);
    const widths = await page.evaluate(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("[data-caption-text]"));
      const byLine = new Map();
      for (const r of range.getClientRects()) {
        const key = Math.round(r.top);
        const [lo, hi] = byLine.get(key) ?? [Infinity, -Infinity];
        byLine.set(key, [Math.min(lo, r.left), Math.max(hi, r.right)]);
      }
      return [...byLine.values()].map(([lo, hi]) => hi - lo);
    });
    ok("caption-wrap: the long caption wraps", widths.length >= 2, `${widths.length} lines`);
    const ratio = Math.min(...widths) / Math.max(...widths);
    ok("caption-wrap: lines are balanced like the export's", ratio > 0.8, `${widths.map((w) => w.toFixed(0)).join(" / ")} (min/max ${ratio.toFixed(2)})`);
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.close();
  },

  // Indic captions are drawn in the bundled Noto faces, the same files the
  // export burns with, whatever the caption font and whatever the operating
  // system has; Latin words in the same caption stay in the caption font.
  // Read-only: the video and its captions are answered here.
  async "script-fonts"(browser, base) {
    const page = await browser.newPage();
    const listing = await (await page.request.get(`${base}/api/videos?limit=50`)).json();
    const video = listing.items.find((v) => v.status === "completed") ?? listing.items[0];
    if (!video) throw new Error("needs at least one video");
    const samples = [
      ["Noto Sans Devanagari", "हमारा सूप tomato"],
      ["Noto Sans Bengali", "আমরা স্যুপ tomato"],
      ["Noto Sans Tamil", "நாம் சூப் tomato"],
      ["Noto Sans Malayalam", "നമുക്ക് സൂപ്പ് tomato"],
      // Russian in the default caption font (Poppins, no Cyrillic).
      ["Noto Sans", "Сначала суп tomato"],
    ];
    await page.route(`**/api/videos/${video.id}`, async (route) => {
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { ...body, status: "completed", stage: null, error_message: null } });
    });
    await page.route(`**/api/videos/${video.id}/captions`, (route) =>
      route.fulfill({
        json: {
          total: samples.length,
          items: samples.map(([, text], i) => ({
            id: i + 1, video_id: video.id, sequence: i, start_ms: i * 2000, end_ms: i * 2000 + 1900, text,
            confidence: -0.2, override_color: null, override_bold: null, override_scale: null,
          })),
        },
      })
    );
    await page.goto(`${base}/editor/${video.id}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
    for (const [i, [family, text]] of samples.entries()) {
      await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, i * 2 + 1);
      await page.waitForFunction((t) => document.querySelector("[data-caption-text]")?.textContent === t, text);
      await page.evaluate(() => document.fonts.ready);
      const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector: "[data-caption-text]" });
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      const names = fonts.map((f) => `${f.familyName}:${f.glyphCount}`).join(", ");
      ok(`script-fonts: ${family} draws its script`, fonts.some((f) => f.familyName === family && f.glyphCount > 0), names);
      ok(`script-fonts: ${family} leaves Latin to the caption font`, fonts.some((f) => !f.familyName.startsWith("Noto Sans") && f.glyphCount >= 6), names);
    }
    await page.close();
  },

  // The caption's grab handle: at least 24x24, the topmost thing at its own
  // centre, starts a drag by mouse and by touch with no jump, stays whole
  // inside the frame when the caption is at the very top, and a click on it
  // focuses it without toggling playback. Changes data: see editorVideo.
  async "caption-handle"(browser, base) {
    for (const width of [1440, 375]) {
      for (const kind of ["mouse", "touch"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: kind === "touch" });
        const page = await context.newPage();
        const id = await editorVideo(page, base);
        await openEditor(page, base, id);
        const at = `caption-handle@${width}/${kind}`;
        const handle = page.getByRole("button", { name: "Move caption" });
        await handle.scrollIntoViewIfNeeded();
        const box = await handle.boundingBox();
        ok(`${at}: hit area at least 24x24`, box && box.width >= 24 && box.height >= 24, box && `${box.width}x${box.height}`);
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[aria-label="Move caption"]'), { x: cx, y: cy });
        ok(`${at}: not covered`, onTop);

        const start = await captionGeometry(page);
        const drag = await pointer(page, kind);
        await drag.down(cx, cy);
        await drag.move(cx + 30, cy - 40);
        await page.waitForTimeout(80);
        const moved = await captionGeometry(page);
        ok(`${at}: dragging the handle moves the caption with no jump`, near(moved.text.cx - start.text.cx, 30) && near(moved.text.cy - start.text.cy, -40), `${(moved.text.cx - start.text.cx).toFixed(1)},${(moved.text.cy - start.text.cy).toFixed(1)}`);
        const after = await handle.boundingBox();
        ok(`${at}: the handle moves with the caption`, near(after.x - box.x, 30) && near(after.y - box.y, -40));
        // Up past the top: the caption stops at the edge and the handle
        // swaps to its lower edge rather than being cut off.
        await drag.move(cx + 30, start.frame.y - 400);
        await page.waitForTimeout(80);
        await drag.up();
        await page.waitForTimeout(150);
        const top = await handle.boundingBox();
        const g = await captionGeometry(page);
        ok(`${at}: whole handle inside the frame at the top`, top.y >= g.frame.y - 0.5 && top.y + top.height <= g.frame.y + g.frame.h + 0.5, `handle y ${top.y.toFixed(1)}, frame y ${g.frame.y.toFixed(1)}`);

        // A press without a move: focus, not play. In view first: a portrait
        // frame is taller than the window, and its top may be scrolled off.
        await handle.scrollIntoViewIfNeeded();
        const h = await handle.boundingBox();
        if (kind === "mouse") await page.mouse.click(h.x + h.width / 2, h.y + h.height / 2);
        else await page.touchscreen.tap(h.x + h.width / 2, h.y + h.height / 2);
        await page.waitForTimeout(150);
        ok(`${at}: a click on the handle leaves playback alone`, await page.evaluate(() => document.querySelector("video").paused));
        if (kind === "mouse") ok(`${at}: a click on the handle focuses it`, await handle.evaluate((e) => e === document.activeElement));
        await page.request.delete(`${base}/api/videos/${id}/style`);
        await context.close();
      }
    }
  },

  // Arrow keys on the focused handle move the caption 1% of the frame, Shift
  // 10%; the move is saved, the page doesn't scroll, and the caption stays
  // inside the frame however many presses. Changes data: see editorVideo.
  async "caption-keyboard"(browser, base) {
    for (const width of [1440, 375]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const id = await editorVideo(page, base);
      await openEditor(page, base, id);
      const at = `caption-keyboard@${width}`;
      const handle = page.getByRole("button", { name: "Move caption" });
      await handle.scrollIntoViewIfNeeded();
      await handle.focus();
      const scroll = await page.evaluate(() => scrollY);
      const playhead = await page.evaluate(() => document.querySelector("video").currentTime);
      const g0 = await captionGeometry(page);
      const f0 = { x: (g0.text.cx - g0.frame.x) / g0.frame.w, y: (g0.text.cy - g0.frame.y) / g0.frame.h };
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(100);
      const g1 = await captionGeometry(page);
      ok(`${at}: ArrowUp moves up 1% of the frame`, near(g1.text.cy - g0.text.cy, -g0.frame.h * 0.01, 1), `${(g1.text.cy - g0.text.cy).toFixed(1)} vs ${(-g0.frame.h * 0.01).toFixed(1)}`);
      await page.keyboard.press("Shift+ArrowUp");
      await page.waitForTimeout(100);
      const g2 = await captionGeometry(page);
      ok(`${at}: Shift+ArrowUp moves up 10%`, near(g2.text.cy - g1.text.cy, -g0.frame.h * 0.1, 1.5), `${(g2.text.cy - g1.text.cy).toFixed(1)} vs ${(-g0.frame.h * 0.1).toFixed(1)}`);
      // Across, predicted with the same clamp the editor applies: a wide
      // caption has little room to move sideways.
      const lo = g2.frame.x + g2.text.w / 2, hi = g2.frame.x + g2.frame.w - g2.text.w / 2;
      const clampX = (x) => Math.max(lo, Math.min(hi, x));
      const afterRight = clampX(g2.text.cx + g2.frame.w * 0.01);
      const expectedX = clampX(afterRight - g2.frame.w * 0.1);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowLeft");
      await page.waitForTimeout(100);
      const g3 = await captionGeometry(page);
      ok(`${at}: ArrowRight then Shift+ArrowLeft, clamped to the frame`, near(g3.text.cx, expectedX, 1.5), `${g3.text.cx.toFixed(1)} vs ${expectedX.toFixed(1)}`);
      ok(`${at}: arrows don't scroll the page`, (await page.evaluate(() => scrollY)) === scroll);
      // The editor's transport shortcuts seek on the arrows; not while the
      // handle has them.
      ok(`${at}: arrows on the handle don't seek the video`, (await page.evaluate(() => document.querySelector("video").currentTime)) === playhead);
      ok(`${at}: the handle keeps focus`, await handle.evaluate((e) => e === document.activeElement));
      for (let k = 0; k < 15; k++) await page.keyboard.press("Shift+ArrowDown");
      for (let k = 0; k < 15; k++) await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(150);
      const g4 = await captionGeometry(page);
      ok(`${at}: stays inside the frame`, g4.text.x + g4.text.w <= g4.frame.x + g4.frame.w + 1 && g4.text.y + g4.text.h <= g4.frame.y + g4.frame.h + 1);
      await page.waitForTimeout(800);
      const saved = await styleOf(page, base, id);
      const fx = (g4.text.cx - g4.frame.x) / g4.frame.w, fy = (g4.text.cy - g4.frame.y) / g4.frame.h;
      ok(`${at}: the keyboard move is saved`, near(saved.pos_x, fx, 0.005) && near(saved.pos_y, fy, 0.005), `${saved.pos_x?.toFixed(3)},${saved.pos_y?.toFixed(3)} vs ${fx.toFixed(3)},${fy.toFixed(3)} (from ${f0.x.toFixed(3)},${f0.y.toFixed(3)})`);
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
