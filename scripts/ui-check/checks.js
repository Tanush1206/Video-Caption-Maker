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
  page.waitForFunction(
    // Whitespace ignored: the caption is drawn as the layout's lines with a
    // space between them, and a word too long for the box is broken across two.
    (t) => document.querySelector("[data-caption-text]")?.textContent.replace(/\s+/g, "") === t.replace(/\s+/g, ""),
    text
  );

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
    const w = document.querySelector("[data-caption-wrap-box]")?.getBoundingClientRect();
    return [s.fontSize, s.letterSpacing, s.webkitTextStrokeWidth, s.textShadow, s.backgroundColor, s.padding, r.x, r.y, r.width, w?.width].join("|");
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

// ── Caption layout checks ──────────────────────────────────────────────
// The texts, looks and sizes of backend/tests/test_caption_layout.py, and
// the line styles (v1.0.8), with Stacked at its own defaults.
const LINE_STYLES = {
  balanced: { line_style: "balanced", max_lines: 2 },
  auto: { line_style: "auto", max_lines: 2 },
  stacked: { line_style: "stacked", words_per_line: 2, max_lines: 4 },
};
const LAYOUT_TEXTS = {
  short: "Hi there",
  long: "Finally, stir everything together until the soup is completely smooth, then serve it hot with fresh bread, a little butter and a handful of chopped herbs on top",
  hindi: "अंत में, सब कुछ चिकना होने तक मिलाएँ और इसे ताज़ी रोटी के साथ परोसें",
  german: "Donaudampfschifffahrtsgesellschaftskapitän und Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz",
  russian: "Наконец, перемешайте все, пока оно не будет гладким, и подайте его с хлебом",
  // A manual line break (Shift+Enter), then a line long enough to wrap.
  manual: "A line I broke\nby hand, and then a much longer second line that the box has to wrap as well",
};
const LOOKS = {
  "box-pad-0": { box_opacity: 1, box_padding: 0, outline_width: 0, shadow: 0 },
  "box-pad-40": { box_opacity: 1, box_padding: 40, outline_width: 0, shadow: 0 },
  "outline-shadow": { box_opacity: 0, outline_width: 8, shadow: 8 },
};
const SIZES = { small: 28, large: 110 };
const GRID = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0.5]];
const SAFE = 0.03;

/** VCM_SAFE_VIDEOS: one 16:9, one 9:16 and one 1:1 video, comma-separated. */
async function safeVideos(page, base) {
  if (process.env.VCM_SAFE_VIDEOS) return process.env.VCM_SAFE_VIDEOS.split(",").map(Number);
  return [await editorVideo(page, base)];
}

/** Answer the video as completed with these captions, two seconds each. */
async function mockCaptions(page, base, id, texts) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.route(`**/api/videos/${id}`, async (route) => {
    const body = await (await route.fetch()).json();
    await route.fulfill({ json: { ...body, status: "completed", stage: null, error_message: null } });
  });
  await page.route(`**/api/videos/${id}/captions`, (route) =>
    route.fulfill({
      json: {
        total: texts.length,
        items: texts.map((text, i) => ({
          id: i + 1, video_id: id, sequence: i, start_ms: i * 2000, end_ms: i * 2000 + 1900, text,
          confidence: -0.2, override_color: null, override_bold: null, override_scale: null,
        })),
      },
    })
  );
}

async function openMocked(page, base, id) {
  await page.goto(`${base}/editor/${id}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
}

/** Seek to caption `i` and wait until it's drawn in its loaded fonts. */
async function showCaption(page, i, text) {
  await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, i * 2 + 1);
  await waitForCaption(page, text);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await waitForCaption(page, text);
}

/** The painted caption — box, or text plus outline and shadow — and the frame. */
const paintedBox = (page) =>
  page.evaluate(() => {
    const box = document.querySelector("[data-caption-box]");
    const f = document.querySelector("video").parentElement.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const s = getComputedStyle(box);
    const out = parseFloat(s.webkitTextStrokeWidth || "0") / 2;
    const shadow = s.textShadow && s.textShadow !== "none" ? parseFloat(s.textShadow.match(/(-?[\d.]+)px/)?.[1] ?? "0") : 0;
    return {
      frame: { x: f.x, y: f.y, w: f.width, h: f.height },
      box: { x: r.x - out, y: r.y - out, w: r.width + 2 * out + shadow, h: r.height + 2 * out + shadow },
    };
  });

function insideSafeArea({ frame, box }) {
  const e = 0.5;
  return (
    box.x >= frame.x + SAFE * frame.w - e && box.y >= frame.y + SAFE * frame.h - e &&
    box.x + box.w <= frame.x + (1 - SAFE) * frame.w + e && box.y + box.h <= frame.y + (1 - SAFE) * frame.h + e
  );
}

const describe = ({ frame, box }) =>
  `l ${((box.x - frame.x) / frame.w * 100).toFixed(1)}% t ${((box.y - frame.y) / frame.h * 100).toFixed(1)}% r ${((frame.x + frame.w - box.x - box.w) / frame.w * 100).toFixed(1)}% b ${((frame.y + frame.h - box.y - box.h) / frame.h * 100).toFixed(1)}%`;

/** Drag the grip to (fx, fy) of the frame — anywhere, including far outside it. */
async function dragGrip(page, fx, fy, kind = "mouse") {
  const grip = page.getByRole("button", { name: "Move caption" });
  await grip.scrollIntoViewIfNeeded();
  const h = await grip.boundingBox();
  const frame = await page.evaluate(() => { const r = document.querySelector("video").parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const drag = await pointer(page, kind);
  const x = h.x + h.width / 2, y = h.y + h.height / 2;
  await drag.down(x, y);
  await drag.move(frame.x + fx * frame.w, frame.y + fy * frame.h);
  await page.waitForTimeout(100);
  await drag.up();
  await page.waitForTimeout(900);
}

/** The wrap box (where the width handles sit), the text and its line count. */
const wrapBox = (page) =>
  page.evaluate(() => {
    const w = document.querySelector("[data-caption-wrap-box]").getBoundingClientRect();
    const t = document.querySelector("[data-caption-box]").getBoundingClientRect();
    const f = document.querySelector("video").parentElement.getBoundingClientRect();
    return {
      x: w.x, w: w.width, cx: w.x + w.width / 2,
      lines: document.querySelectorAll("[data-caption-line]").length,
      text: { w: t.width, h: t.height },
      frame: { x: f.x, y: f.y, w: f.width, h: f.height },
    };
  });

/** The burn's layout of these texts (backend/scripts/caption_layout.py), via the dev stack. */
function burnLayout(style, texts, frame) {
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  const out = execFileSync(
    "docker",
    ["compose", "exec", "-T", "backend", "python", "scripts/caption_layout.py"],
    { cwd: path.resolve(__dirname, "../.."), input: JSON.stringify({ style, texts, width: frame.width, height: frame.height }), encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }
  );
  return JSON.parse(out);
}

/**
 * Answer the language step's own requests, so a check picks a file without
 * uploading it (v1.0.9 uploads on pick). Matched by path, not origin: the dev
 * frontend calls the API on its own port. `heard` is what detection says, or
 * null for "not yet"; the returned log holds what Start and Back sent.
 */
async function mockHeldUpload(page, base, heard) {
  const id = 999_000_001;
  const log = { started: null, deleted: false };
  const video = (extra = {}) => ({
    id, title: "clip", original_filename: "clip.mp4", size_bytes: 18, content_type: "video/mp4",
    duration_ms: 60000, status: "pending", error_message: null, has_thumbnail: false,
    spoken_language: "auto", caption_language: "same", hindi_script: null,
    detected_language: null, detected_confidence: null, held: true, progress: 0,
    stage: "detecting", stage_detail: null, notice: null,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...extra,
  });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(/\/api\/videos$/, (route) => (route.request().method() === "POST" ? json(route, video(), 201) : route.fallback()));
  await page.route(new RegExp(`/api/videos/${id}$`), (route) => {
    if (route.request().method() === "DELETE") {
      log.deleted = true;
      return route.fulfill({ status: 204 });
    }
    return json(route, heard ? video({ detected_language: heard[0], detected_confidence: heard[1], stage: null }) : video());
  });
  await page.route(new RegExp(`/api/videos/${id}/transcribe$`), (route) => {
    log.started = route.request().postDataJSON();
    return json(route, video({ held: false, status: "pending", stage: null }));
  });
  return log;
}

// Taken out in v1.0.11; no picker may offer them.
const REMOVED_NAMES = ["தமிழ்", "मराठी", "বাংলা", "മലയാളം", "Tamil", "Marathi", "Bengali", "Malayalam"];

const CHECKS = {
  // Another origin can't show the app in a frame (clickjacking): a page served
  // from 127.0.0.1 on a spare port frames <base>/dashboard, and the frame must
  // not render the app. Reads only.
  async framing(browser, base) {
    const http = require("node:http");
    const server = http.createServer((_, res) => {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><iframe src="${base}/dashboard" style="width:900px;height:600px"></iframe>`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const page = await browser.newPage();
    const refused = [];
    page.on("console", (m) => /frame-ancestors|X-Frame-Options/i.test(m.text()) && refused.push(m.text()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "load" });
    await page.waitForTimeout(2500);
    const rendered = [];
    for (const frame of page.frames().slice(1)) {
      const text = await frame.evaluate(() => document.body?.innerText ?? "").catch(() => "");
      if (/Videos|Settings|VideoCaptionMaker/.test(text)) rendered.push(frame.url());
    }
    ok("framing: another origin can't render the app in a frame", rendered.length === 0, rendered.join(", "));
    ok("framing: the browser says why", refused.length > 0, refused[0]?.slice(0, 90));
    await page.close();
    server.close();
  },

  // The frontend's own guard (src/middleware.ts): another site may link here
  // but not send anything else, the Host must be this computer, and the image
  // optimiser is gone. Requests are sent with the headers a browser would set.
  // Reads only.
  async "frontend-guard"(browser, base) {
    const page = await browser.newPage();
    const status = async (path, headers = {}, method = "GET") =>
      (await page.request.fetch(`${base}${path}`, { method, headers, maxRedirects: 0 })).status();
    const crossSite = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" };
    const sameSite = { "sec-fetch-site": "same-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" };
    const linked = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
    ok("frontend-guard: a cross-site fetch of a page is refused", (await status("/dashboard", crossSite)) === 403);
    ok("frontend-guard: another localhost port's request is refused", (await status("/settings", sameSite)) === 403);
    ok("frontend-guard: a cross-site form post is refused", (await status("/dashboard", linked, "POST")) === 403);
    ok("frontend-guard: a link from another site still opens the app", (await status("/dashboard", linked)) === 200);
    ok("frontend-guard: a script without browser headers passes", (await status("/healthz")) === 200);
    ok("frontend-guard: a rebinding Host is refused", (await status("/dashboard", { host: "attacker.example" })) === 403);
    ok("frontend-guard: /_next/image is gone", (await status("/_next/image?url=%2Ffavicon.ico&w=64&q=75")) === 404);
    await page.close();
  },

  // No Content-Security-Policy violation on the main pages: the policy lets
  // through everything the app really loads. Reads only.
  async csp(browser, base) {
    const page = await browser.newPage();
    const violations = [];
    page.on("console", (m) => /Content Security Policy|Refused to (load|execute|connect|apply)/i.test(m.text()) && violations.push(m.text()));
    const listing = await (await page.request.get(`${base}/api/videos?limit=50`)).json();
    const video = listing.items.find((v) => v.status === "completed");
    const paths = ["/dashboard", "/search", "/settings", ...(video ? [`/editor/${video.id}`] : [])];
    for (const path of paths) {
      await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
    }
    ok(`csp: no violations on ${paths.join(", ")}`, violations.length === 0, violations.slice(0, 2).join(" | ").slice(0, 200));
    await page.close();
  },

  // While the video plays, the overlay shows the caption under the playhead
  // within one frame: on every presented frame (requestVideoFrameCallback),
  // its text against the caption the API says covers that frame's time. A
  // mismatch counts only if no caption starts or ends within a frame of it.
  // Plays VCM_CHECK_SECONDS (default 20) from the first caption; reads only.
  async "caption-timing"(browser, base) {
    const page = await browser.newPage();
    const id = await editorVideo(page, base);
    const captions = (await (await page.request.get(`${base}/api/videos/${id}/captions`)).json()).items;
    await page.goto(`${base}/editor/${id}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2);
    const seconds = Number(process.env.VCM_CHECK_SECONDS || 20);
    const frames = await page.evaluate(async ({ from, seconds }) => {
      const video = document.querySelector("video");
      video.muted = true;
      video.currentTime = from / 1000;
      await new Promise((resolve) => video.addEventListener("seeked", resolve, { once: true }));
      const out = [];
      await new Promise((resolve) => {
        const onFrame = (_, meta) => {
          out.push({ t: meta.mediaTime * 1000, text: document.querySelector("[data-caption-text]")?.textContent ?? "" });
          if (meta.mediaTime * 1000 - from > seconds * 1000) resolve();
          else video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
        video.play();
      });
      video.pause();
      return out;
    }, { from: Math.max(0, captions[0].start_ms - 500), seconds });
    const steps = frames.slice(1).map((f, i) => f.t - frames[i].t).filter((d) => d > 0).sort((a, b) => a - b);
    const frame = steps[Math.floor(steps.length / 2)] || 1000 / 30;
    const bare = (s) => s.replace(/\s+/g, "");
    const late = [];
    for (const { t, text } of frames) {
      const want = captions.find((c) => c.start_ms <= t && t < c.end_ms)?.text ?? "";
      if (bare(want) === bare(text)) continue;
      const boundary = captions.some((c) => Math.abs(c.start_ms - t) <= frame + 1 || Math.abs(c.end_ms - t) <= frame + 1);
      if (!boundary) late.push(`${(t / 1000).toFixed(3)}s shows "${text.slice(0, 16)}" for "${want.slice(0, 16)}"`);
    }
    ok(`caption-timing: ${frames.length} frames sampled (frame ${frame.toFixed(1)} ms)`, frames.length > seconds * 10);
    ok("caption-timing: overlay matches the playhead within one frame", late.length === 0, `${late.length} off: ${late.slice(0, 3).join(" | ")}`);
    await page.close();
  },

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
    ok("editor-languages: Tamil, Marathi, Bengali, Malayalam not offered (v1.0.11)", !texts.some((t) => REMOVED_NAMES.some((name) => t.includes(name))), texts.join(" / "));
    const search = page.getByRole("combobox", { name: "Search caption languages" });
    ok("editor-languages: search has focus on open", await search.evaluate((e) => e === document.activeElement));
    await search.fill("rus");
    ok("editor-languages: search by English name", (await options.allInnerTexts()).join("|").includes("Русский") && (await options.count()) === 1);
    await search.fill("espanol");
    ok("editor-languages: search ignores accents", (await options.count()) === 1 && (await options.first().innerText()).includes("Español"));
    await search.fill("हिन्दी");
    ok("editor-languages: search by native name", (await options.count()) === 1);
    await search.fill("zzz");
    ok("editor-languages: says when nothing matches", (await page.getByText("No language matches").count()) === 1);
    await search.fill("deu");
    await page.keyboard.press("Enter");
    ok("editor-languages: Enter chooses and closes", (await trigger.getAttribute("aria-expanded")) === "false" && (await trigger.getAttribute("aria-label")).includes("Deutsch"));
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
      await mockHeldUpload(page, base, ["en", 0.99]);
      await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').first().setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
      const group = page.getByRole("radiogroup", { name: "Caption into" });
      await group.waitFor();
      const cards = group.getByRole("radio");
      ok(`${at}: a card per served language`, (await cards.count()) === served.length, `${await cards.count()} vs ${served.length}`);
      const all = await group.locator("label").allInnerTexts();
      ok(`${at}: Tamil, Marathi, Bengali, Malayalam not offered (v1.0.11)`, !all.some((t) => REMOVED_NAMES.some((name) => t.includes(name))), all.join(" / "));
      const search = page.getByRole("searchbox", { name: "Search caption languages" });
      await search.fill("german");
      const shown = await group.locator("label").allInnerTexts();
      ok(`${at}: search by English name`, shown.length === 2 && shown[1].includes("Deutsch"), shown.join(" / "));
      await search.fill("Русский");
      ok(`${at}: search by native name`, (await cards.count()) === 2);
      await search.fill("nl");
      ok(`${at}: search by code`, (await group.locator("label").allInnerTexts()).some((t) => t.includes("Nederlands")));
      await search.fill("klingon");
      ok(`${at}: only "Same as spoken" when nothing matches`, (await cards.count()) === 1);
      ok(`${at}: says nothing matches`, await page.getByRole("status").filter({ hasText: "No caption language matches" }).isVisible());
      await search.fill("italian");
      await group.locator("label").nth(1).click();
      ok(`${at}: a found language can be chosen`, await group.getByRole("radio", { checked: true }).evaluate((e) => e.value === "it"));
      await search.fill("");
      ok(`${at}: clearing the search shows them all`, (await cards.count()) === served.length);
      await page.close();
    }
  },

  // The language step's Hindi script choice (v1.0.9), with the API mocked so
  // each detection outcome is certain: Hindi heard surely presets Hinglish;
  // Hindi heard unsurely asks with nothing preset and Start waits; no answer
  // in 15 s asks without holding Start; English captions don't ask; Back
  // deletes the upload. Checks what Start sends each time. Read-only.
  async "hindi-script"(browser, base) {
    const pick = async (page) => {
      await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').first().setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
    };
    const start = (page) => page.getByRole("button", { name: /Start generating captions/ });
    const group = (page) => page.getByRole("radiogroup", { name: /captions in/i });

    const { AxeBuilder } = require("@axe-core/playwright");
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width: 1440, height: 900 } });
      await context.addInitScript((t) => localStorage.setItem("vcm-theme", t), theme);
      const page = await context.newPage();
      await mockHeldUpload(page, base, ["hi", 0.6]);
      await pick(page);
      await group(page).waitFor();
      await page.waitForTimeout(1000);
      const found = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations;
      ok(`hindi-script: axe 0 with the choice open (${theme})`, found.length === 0, found.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(" | "));
      await context.close();
    }

    for (const width of [1440, 375]) {
      const at = `hindi-script@${width}`;
      let page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      let log = await mockHeldUpload(page, base, ["hi", 0.94]);
      await pick(page);
      await group(page).waitFor();
      ok(`${at}: Hindi heard surely presets Hinglish`, await group(page).getByRole("radio", { checked: true }).evaluate((e) => e.value === "roman"));
      ok(`${at}: says what it heard`, await page.getByText("Hindi · heard at 94%").isVisible());
      await start(page).click();
      await page.waitForURL(/\/editor\//);
      ok(`${at}: Start sends Hinglish`, JSON.stringify(log.started) === JSON.stringify({ spoken_language: "hi", caption_language: "same", hindi_script: "roman" }), JSON.stringify(log.started));
      await page.context().close();

      page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      log = await mockHeldUpload(page, base, ["hi", 0.6]);
      await pick(page);
      await group(page).waitFor();
      ok(`${at}: Hindi heard unsurely asks with nothing preset`, (await group(page).getByRole("radio", { checked: true }).count()) === 0);
      ok(`${at}: two answers`, (await group(page).getByRole("radio").count()) === 2);
      ok(`${at}: Start waits for an answer`, await start(page).isDisabled());
      await group(page).locator("label").nth(1).click();
      ok(`${at}: an answer enables Start`, await start(page).isEnabled());
      await start(page).click();
      await page.waitForURL(/\/editor\//);
      ok(`${at}: Start sends Devanagari`, log.started?.hindi_script === "devanagari" && log.started?.spoken_language === "hi", JSON.stringify(log.started));
      await page.context().close();

      page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      log = await mockHeldUpload(page, base, null);
      await pick(page);
      ok(`${at}: nothing asked while listening`, (await group(page).count()) === 0);
      await group(page).waitFor({ timeout: 20000 });
      ok(`${at}: after 15 s it asks with nothing preset`, (await group(page).getByRole("radio", { checked: true }).count()) === 0);
      ok(`${at}: and Start doesn't wait`, await start(page).isEnabled());
      await start(page).click();
      await page.waitForURL(/\/editor\//);
      ok(`${at}: unanswered, the job decides`, log.started?.hindi_script === "auto" && log.started?.spoken_language === "auto", JSON.stringify(log.started));
      await page.context().close();

      page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      log = await mockHeldUpload(page, base, ["hi", 0.94]);
      await pick(page);
      await group(page).waitFor();
      await page.getByRole("radiogroup", { name: "Caption into" }).locator("label", { hasText: "English" }).first().click();
      ok(`${at}: English captions don't ask`, (await group(page).count()) === 0);
      await page.getByRole("button", { name: "Choose a different video" }).click();
      await page.waitForTimeout(300);
      ok(`${at}: Back deletes the upload`, log.deleted);
      await page.context().close();
    }
  },

  // Speech heard in a language not offered (v1.0.11), with the API mocked:
  // the step says so ("Tamil speech isn't supported yet…"), presets nothing
  // and holds Start; "Try anyway" sends auto; a spoken language chosen
  // instead is sent, and Hindi chosen asks how it's written with nothing
  // preset. The picker offers the served spoken languages only. axe 0 with
  // the notice open, light and dark. Read-only.
  async "unsupported-speech"(browser, base) {
    const pick = async (page) => {
      await page.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
      await page.locator('input[type="file"]').first().setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video") });
    };
    const start = (page) => page.getByRole("button", { name: /Start generating captions/ });
    const anyway = (page) => page.getByRole("button", { name: "Try anyway (low quality)" });
    const picker = (page) => page.getByRole("button", { name: /^Spoken language:/ });
    const served = (await (await (await browser.newPage()).request.get(`${base}/api/videos/languages`)).json()).spoken;

    const { AxeBuilder } = require("@axe-core/playwright");
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({ colorScheme: theme, viewport: { width: 1440, height: 900 } });
      await context.addInitScript((t) => localStorage.setItem("vcm-theme", t), theme);
      const page = await context.newPage();
      await mockHeldUpload(page, base, ["ta", 0.93]);
      await pick(page);
      await anyway(page).waitFor();
      await page.waitForTimeout(1000);
      const found = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations;
      ok(`unsupported-speech: axe 0 with the notice open (${theme})`, found.length === 0, found.map((v) => `${v.id} ${v.nodes[0]?.target}`).join(" | "));
      await context.close();
    }

    for (const width of [1440, 375]) {
      const at = `unsupported-speech@${width}`;
      let page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      let log = await mockHeldUpload(page, base, ["ta", 0.93]);
      await pick(page);
      await anyway(page).waitFor();
      ok(`${at}: says Tamil isn't supported`, await page.getByText("Tamil speech isn't supported yet, so captions would be inaccurate.").isVisible());
      ok(`${at}: nothing chosen`, (await anyway(page).getAttribute("aria-pressed")) === "false" && (await picker(page).getAttribute("aria-label")) === "Spoken language: none");
      ok(`${at}: Start waits for a choice`, await start(page).isDisabled());
      await picker(page).click();
      const offered = await page.getByRole("listbox", { name: "Spoken language" }).getByRole("option").allInnerTexts();
      ok(`${at}: the served spoken languages only`, offered.length === served.length - 1 && !offered.some((t) => REMOVED_NAMES.some((name) => t.includes(name))), offered.join(" / "));
      await page.keyboard.press("Escape");
      await anyway(page).click();
      ok(`${at}: Try anyway chosen`, (await anyway(page).getAttribute("aria-pressed")) === "true");
      ok(`${at}: Try anyway enables Start`, await start(page).isEnabled());
      await start(page).click();
      await page.waitForURL(/\/editor\//);
      ok(`${at}: Try anyway sends auto`, JSON.stringify(log.started) === JSON.stringify({ spoken_language: "auto", caption_language: "same", hindi_script: "auto" }), JSON.stringify(log.started));
      await page.context().close();

      page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      log = await mockHeldUpload(page, base, ["ta", 0.93]);
      await pick(page);
      await anyway(page).waitFor();
      await picker(page).click();
      await page.getByRole("combobox", { name: "Search spoken languages" }).fill("english");
      await page.keyboard.press("Enter");
      ok(`${at}: a spoken language chosen enables Start`, await start(page).isEnabled());
      await start(page).click();
      await page.waitForURL(/\/editor\//);
      ok(`${at}: Start sends the chosen language`, JSON.stringify(log.started) === JSON.stringify({ spoken_language: "en", caption_language: "same" }), JSON.stringify(log.started));
      await page.context().close();

      page = await (await browser.newContext({ viewport: { width, height: 900 } })).newPage();
      log = await mockHeldUpload(page, base, ["mr", 0.81]);
      await pick(page);
      await anyway(page).waitFor();
      ok(`${at}: says Marathi isn't supported`, await page.getByText("Marathi speech isn't supported yet, so captions would be inaccurate.").isVisible());
      await picker(page).click();
      await page.getByRole("combobox", { name: "Search spoken languages" }).fill("hindi");
      await page.keyboard.press("Enter");
      const scripts = page.getByRole("radiogroup", { name: /captions in/i });
      await scripts.waitFor();
      ok(`${at}: Hindi chosen asks how it's written, nothing preset`, (await scripts.getByRole("radio", { checked: true }).count()) === 0);
      ok(`${at}: and Start waits for it`, await start(page).isDisabled());
      await scripts.locator("label").nth(1).click();
      await start(page).click();
      await page.waitForURL(/\/editor\//);
      ok(`${at}: Start sends Hindi in Devanagari`, JSON.stringify(log.started) === JSON.stringify({ spoken_language: "hi", caption_language: "same", hindi_script: "devanagari" }), JSON.stringify(log.started));
      await page.context().close();
    }
  },

  // A video made in a language no longer offered (v1.0.11) still opens: its
  // captions, its language named, a note that the speech isn't supported,
  // and the Redo asks for an offered language instead of failing. Export is
  // there. The video is answered as Tamil by the check. Read-only.
  async "retired-language"(browser, base) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const id = await editorVideo(page, base);
    await page.route(new RegExp(`/api/videos/${id}$`), async (route) => {
      const body = await (await route.fetch()).json();
      await route.fulfill({ json: { ...body, status: "completed", stage: null, spoken_language: "auto", caption_language: "ta", detected_language: "ta", notice: null } });
    });
    await page.route(new RegExp(`/api/videos/${id}/captions$`), (route) =>
      route.fulfill({
        json: {
          total: 1,
          items: [{
            id: 1, video_id: id, sequence: 0, start_ms: 0, end_ms: 1000, text: "நாம் சூப் செய்வோம்",
            confidence: -0.2, override_color: null, override_bold: null, override_scale: null,
          }],
        },
      })
    );
    await page.goto(`${base}/editor/${id}`, { waitUntil: "networkidle" });
    ok("retired-language: the captions show", (await page.locator("textarea").first().inputValue()) === "நாம் சூப் செய்வோம்");
    ok("retired-language: named Tamil", (await page.getByText(/→ Tamil/).count()) > 0);
    ok("retired-language: says the speech isn't supported", await page.getByText("Tamil speech isn't supported yet, so these captions are likely inaccurate.").isVisible());
    ok("retired-language: Redo asks for an offered language", await page.getByText("Tamil captions are no longer offered").isVisible() && (await page.getByRole("button", { name: "Redo" }).isDisabled()));
    ok("retired-language: Export is there", (await page.getByRole("button", { name: /Export/ }).count()) + (await page.getByRole("link", { name: /Export/ }).count()) > 0);
    await context.close();
  },

  // The editor's Redo offers "Hindi in" for a video with no language
  // recorded (made before v1.0.9) and one heard as Hindi, not for one heard
  // as English; choosing Hinglish sends it. The Redo request is answered by
  // the check: nothing is transcribed. Needs a completed video
  // (VCM_CHECK_VIDEO or the newest). Read-only (v1.0.10).
  async "redo-script"(browser, base) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const id = await editorVideo(page, base);
    const select = () => page.getByLabel("Hindi in");
    for (const [heard, offered] of [[null, true], ["hi", true], ["en", false]]) {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      let sent = null;
      await page.route(new RegExp(`/api/videos/${id}$`), async (route) => {
        const body = await (await route.fetch()).json();
        await route.fulfill({ json: { ...body, status: "completed", stage: null, caption_language: "hi", spoken_language: "auto", hindi_script: null, detected_language: heard } });
      });
      await page.route(new RegExp(`/api/videos/${id}/transcribe$`), async (route) => {
        sent = route.request().postDataJSON();
        const body = await (await page.request.get(`${base}/api/videos/${id}`)).json();
        await route.fulfill({ json: { ...body, status: "pending" } });
      });
      await page.goto(`${base}/editor/${id}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Redo/ }).waitFor();
      const shown = (await select().count()) > 0;
      ok(`redo-script: heard ${heard ?? "nothing recorded"} ${offered ? "offers" : "doesn't offer"} "Hindi in"`, shown === offered);
      if (offered && shown) {
        ok(`redo-script: ${heard ?? "nothing recorded"} defaults to Devanagari`, (await select().inputValue()) === "devanagari");
        await select().selectOption("roman");
        await page.getByRole("button", { name: /Redo/ }).click();
        await page.waitForURL(/\/dashboard/);
        ok(`redo-script: ${heard ?? "nothing recorded"} sends Hinglish`, sent?.hindi_script === "roman", JSON.stringify(sent));
      }
    }
    await context.close();
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
            const w = document.querySelector("[data-caption-wrap-box]")?.getBoundingClientRect();
            return [s.fontSize, s.letterSpacing, s.webkitTextStrokeWidth, s.textShadow, s.backgroundColor, s.padding, r.x, r.y, r.width, w?.width].join("|") !== b;
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
        const dy = -Math.min(frame.h * 0.3, start.text.cy - 20, start.text.y - frame.y - SAFE * frame.h - 10);
        await drag.move(start.text.cx + 12, start.text.cy + dy);
        await page.waitForTimeout(80);
        now = await captionGeometry(page);
        const travelled = (now.text.cy - now.frame.y) - (start.text.cy - start.frame.y);
        const scrolled = now.frame.y - start.frame.y;
        ok(`${at}: follows the pointer`, near(travelled, dy - scrolled), `${travelled.toFixed(1)} vs ${(dy - scrolled).toFixed(1)}`);

        // Far past each edge in turn: the caption stays whole, its own size,
        // and inside the safe area.
        for (const [name, x, y] of [["right", frame.x + frame.w * 3, now.text.cy], ["bottom", now.text.cx, frame.y + frame.h * 3], ["left", frame.x - frame.w * 2, now.text.cy], ["top", now.text.cx, frame.y - frame.h * 2]]) {
          await drag.move(x, y);
          await page.waitForTimeout(80);
          const g = await captionGeometry(page);
          const p = await paintedBox(page);
          ok(`${at}: past the ${name} edge stays inside the safe area`, insideSafeArea(p), describe(p));
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
  // (times the layout's shrink, a 2% step) and each line is one cell tall.
  // Measured against the burn on dev: within 1% in width for Liberation Sans,
  // Poppins and Lato (Poppins Bold was 1.76x before). Changes data.
  async "caption-size"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    // A Latin caption: a line with a script face is as tall as that face's
    // cell, as in libass, which is the layout's business, not this check's.
    await mockCaptions(page, base, id, [LAYOUT_TEXTS.short]);
    await openMocked(page, base, id);
    await showCaption(page, 0, LAYOUT_TEXTS.short);
    for (const font of ["sans", "poppins", "lato", "anton"]) {
      const style = await (await page.request.patch(`${base}/api/videos/${id}/style`, { data: { font_key: font, font_size: 80, max_lines: 3 } })).json();
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
      await page.locator("[data-caption-line]").first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      const got = await page.evaluate(() => {
        const t = document.querySelector("[data-caption-text]");
        const frame = document.querySelector("video").parentElement.getBoundingClientRect();
        const line = document.querySelector("[data-caption-line]").getBoundingClientRect();
        return { size: parseFloat(getComputedStyle(t).fontSize), line: line.height, frameH: frame.height };
      });
      const scale = got.frameH / style.reference_height;
      const full = (style.font_size * scale) / style.font_win_span;
      const shrink = got.size / full;
      const step = Math.abs(shrink * 50 - Math.round(shrink * 50)) < 0.01 && shrink <= 1 + 1e-3 && shrink >= 0.7 - 1e-3;
      ok(`caption-size: ${font} served a win span`, style.font_win_span > 1, String(style.font_win_span));
      ok(`caption-size: ${font} font-size = size x scale / span x a 2% shrink step`, step, `${got.size.toFixed(2)} vs ${full.toFixed(2)} (x${shrink.toFixed(3)})`);
      ok(`caption-size: ${font} line height = the libass cell`, Math.abs(got.line - got.size * style.font_win_span) < 0.1, `${got.line.toFixed(2)} vs ${(got.size * style.font_win_span).toFixed(2)}`);
    }
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.close();
  },

  // A caption that wraps breaks into lines of about the same width, the way
  // the layout breaks it for the burn too: two or three even lines rather
  // than one full line and a word. Changes data: see editorVideo.
  async "caption-wrap"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    await mockCaptions(page, base, id, [LAYOUT_TEXTS.long]);
    for (const [box_width, max_lines] of [[0.8, 2], [0.5, 3]]) {
      await page.request.patch(`${base}/api/videos/${id}/style`, { data: { font_size: 54, box_width, max_lines, pos_x: 0.5, pos_y: 0.5 } });
      await openMocked(page, base, id);
      await showCaption(page, 0, LAYOUT_TEXTS.long);
      const widths = await page.evaluate(() =>
        [...document.querySelectorAll("[data-caption-line]")].map((line) => {
          const range = document.createRange();
          range.selectNodeContents(line);
          return range.getBoundingClientRect().width;
        })
      );
      const at = `caption-wrap@${box_width}/${max_lines}`;
      ok(`${at}: the long caption wraps`, widths.length >= 2, `${widths.length} lines`);
      const ratio = Math.min(...widths) / Math.max(...widths);
      ok(`${at}: lines are even`, ratio > 0.75, `${widths.map((w) => w.toFixed(0)).join(" / ")} (min/max ${ratio.toFixed(2)})`);
    }
    await page.unrouteAll({ behavior: "ignoreErrors" });
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
      // Across, predicted with the safe area the layout keeps it in: a wide
      // caption has little room to move sideways. The bound is approximate
      // (the layout also keeps room for glyph overhang), hence the tolerance.
      const lo = g2.frame.x + SAFE * g2.frame.w + g2.text.w / 2, hi = g2.frame.x + (1 - SAFE) * g2.frame.w - g2.text.w / 2;
      const clampX = (x) => Math.max(lo, Math.min(hi, x));
      const afterRight = clampX(g2.text.cx + g2.frame.w * 0.01);
      const expectedX = clampX(afterRight - g2.frame.w * 0.1);
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("Shift+ArrowLeft");
      await page.waitForTimeout(100);
      const g3 = await captionGeometry(page);
      ok(`${at}: ArrowRight then Shift+ArrowLeft, kept in the safe area`, near(g3.text.cx, expectedX, 6), `${g3.text.cx.toFixed(1)} vs ${expectedX.toFixed(1)}`);
      ok(`${at}: arrows don't scroll the page`, (await page.evaluate(() => scrollY)) === scroll);
      // The editor's transport shortcuts seek on the arrows; not while the
      // handle has them.
      ok(`${at}: arrows on the handle don't seek the video`, (await page.evaluate(() => document.querySelector("video").currentTime)) === playhead);
      ok(`${at}: the handle keeps focus`, await handle.evaluate((e) => e === document.activeElement));
      for (let k = 0; k < 15; k++) await page.keyboard.press("Shift+ArrowDown");
      for (let k = 0; k < 15; k++) await page.keyboard.press("Shift+ArrowRight");
      await page.waitForTimeout(150);
      const g4 = await captionGeometry(page);
      const p4 = await paintedBox(page);
      ok(`${at}: stays inside the safe area`, insideSafeArea(p4), describe(p4));
      await page.waitForTimeout(800);
      const saved = await styleOf(page, base, id);
      const fx = (g4.text.cx - g4.frame.x) / g4.frame.w, fy = (g4.text.cy - g4.frame.y) / g4.frame.h;
      ok(`${at}: the keyboard move is saved`, near(saved.pos_x, fx, 0.005) && near(saved.pos_y, fy, 0.005), `${saved.pos_x?.toFixed(3)},${saved.pos_y?.toFixed(3)} vs ${fx.toFixed(3)},${fy.toFixed(3)} (from ${f0.x.toFixed(3)},${f0.y.toFixed(3)})`);
      await page.request.delete(`${base}/api/videos/${id}/style`);
      await page.close();
    }
  },
  // The caption box is fully inside the safe area (3% from every edge) in the
  // preview, for a grid of positions — corners, edge centres, the centre, and
  // dragged far outside the frame on each side — x five texts (short and long
  // English, Hindi, German with long words, Russian) x padding 0 and large x
  // small and large font, on every video in VCM_SAFE_VIDEOS (one each 16:9,
  // 9:16 and 1:1; default: the editor video). Measures the painted element:
  // the box, or the text plus its outline and shadow. Changes data.
  async "caption-safe-area"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const ids = await safeVideos(page, base);
    for (const id of ids) {
      await mockCaptions(page, base, id, Object.values(LAYOUT_TEXTS));
      for (const [look, lookFields] of Object.entries(LOOKS)) {
        for (const [size, font_size] of Object.entries(SIZES)) {
          const style = { ...lookFields, font_size, box_width: null, max_lines: 2 };
          const at = `caption-safe-area@${id}/${look}/${size}`;
          const failures = [];
          for (const [x, y] of GRID) {
            await page.request.patch(`${base}/api/videos/${id}/style`, { data: { ...style, pos_x: x, pos_y: y } });
            await openMocked(page, base, id);
            for (const [name, text] of Object.entries(LAYOUT_TEXTS)) {
              await showCaption(page, Object.values(LAYOUT_TEXTS).indexOf(text), text);
              const g = await paintedBox(page);
              if (!insideSafeArea(g)) failures.push(`${name}@${x},${y}: ${describe(g)}`);
            }
          }
          ok(`${at}: inside the safe area at every grid position`, failures.length === 0, failures.slice(0, 3).join("; "));
          // Far outside on each side, by dragging the grip.
          const dragged = [];
          for (const [side, fx, fy] of [["left", -3, 0.5], ["right", 4, 0.5], ["top", 0.5, -3], ["bottom", 0.5, 4]]) {
            await page.request.patch(`${base}/api/videos/${id}/style`, { data: { ...style, pos_x: 0.5, pos_y: 0.5 } });
            await openMocked(page, base, id);
            await showCaption(page, 1, LAYOUT_TEXTS.long);
            await dragGrip(page, fx, fy);
            for (const [name, text] of Object.entries(LAYOUT_TEXTS)) {
              await showCaption(page, Object.values(LAYOUT_TEXTS).indexOf(text), text);
              const g = await paintedBox(page);
              if (!insideSafeArea(g)) dragged.push(`${name} past ${side}: ${describe(g)}`);
            }
          }
          ok(`${at}: inside the safe area when dragged far past each edge`, dragged.length === 0, dragged.slice(0, 3).join("; "));
        }
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.request.delete(`${base}/api/videos/${id}/style`);
    }
    await page.close();
  },

  // The box's width: the handles on its edges change it by mouse, touch and
  // keyboard; the Max width slider changes it too, and both show the same
  // value; it doesn't change when the box is dragged from the centre to any
  // edge; Max lines and the font shrink work. Changes data.
  async "caption-width"(browser, base) {
    for (const width of [1440, 375]) {
      for (const kind of ["mouse", "touch"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: kind === "touch" });
        const page = await context.newPage();
        const id = await editorVideo(page, base);
        const at = `caption-width@${width}/${kind}`;
        await mockCaptions(page, base, id, [LAYOUT_TEXTS.long, LAYOUT_TEXTS.short]);
        await page.request.delete(`${base}/api/videos/${id}/style`);
        await page.request.patch(`${base}/api/videos/${id}/style`, { data: { pos_x: 0.5, pos_y: 0.5, font_size: 40, max_lines: 3 } });
        await openMocked(page, base, id);
        await showCaption(page, 0, LAYOUT_TEXTS.long);

        const right = page.locator('[data-width-handle="right"]');
        await right.scrollIntoViewIfNeeded();
        const before = await wrapBox(page);
        const h = await right.boundingBox();
        const drag = await pointer(page, kind);
        await drag.down(h.x + h.width / 2, h.y + h.height / 2);
        await drag.move(h.x + h.width / 2 - before.frame.w * 0.25, h.y + h.height / 2);
        await page.waitForTimeout(100);
        await drag.up();
        await page.waitForTimeout(900);
        const after = await wrapBox(page);
        const expected = before.w - before.frame.w * 0.5;
        ok(`${at}: dragging the right edge in narrows the box both sides`, near(after.w, expected, 3) && near(after.cx, before.cx, 2), `${after.w.toFixed(0)} vs ${expected.toFixed(0)}`);
        ok(`${at}: the text rewraps inside the narrower box`, after.text.w <= after.w + 1 && after.text.w < before.text.w, `text ${before.text.w.toFixed(0)} → ${after.text.w.toFixed(0)}, box ${after.w.toFixed(0)}`);
        const saved = await styleOf(page, base, id);
        ok(`${at}: the width is saved`, near(saved.box_width, after.w / after.frame.w, 0.005), `${saved.box_width} vs ${(after.w / after.frame.w).toFixed(3)}`);
        await page.getByRole("radio", { name: "Position" }).click();
        const slider = page.getByLabel(/^Max width —/);
        ok(`${at}: the Max width slider shows it`, Number(await slider.inputValue()) === Math.round(saved.box_width * 100), `${await slider.inputValue()} vs ${saved.box_width}`);

        // The slider moves the handles.
        await slider.evaluate((e) => e.scrollIntoView({ block: "center" }));
        await slider.focus();
        for (let k = 0; k < 10; k++) await page.keyboard.press("ArrowRight");
        await page.waitForTimeout(900);
        const slid = await wrapBox(page);
        ok(`${at}: the slider widens the box on the video`, near(slid.w, after.w + slid.frame.w * 0.1, 3), `${slid.w.toFixed(0)} vs ${(after.w + slid.frame.w * 0.1).toFixed(0)}`);
        const handleNow = await right.boundingBox();
        ok(`${at}: the handle follows the slider`, near(handleNow.x + handleNow.width / 2, slid.x + slid.w, 2));

        // Keyboard on the handle: outward widens by 1%.
        if (kind === "mouse") {
          await right.focus();
          await page.keyboard.press("ArrowRight");
          await page.waitForTimeout(900);
          const keyed = await styleOf(page, base, id);
          ok(`${at}: ArrowRight on the right edge widens by 1%`, near(keyed.box_width, Math.round(saved.box_width * 100 + 10 + 1) / 100, 0.002), String(keyed.box_width));
          ok(`${at}: the slider follows the handle`, Number(await slider.inputValue()) === Math.round(keyed.box_width * 100));
        }

        // Dragged from the centre to each edge: same width, same lines.
        await page.request.patch(`${base}/api/videos/${id}/style`, { data: { pos_x: 0.5, pos_y: 0.5, box_width: 0.6 } });
        await openMocked(page, base, id);
        await showCaption(page, 0, LAYOUT_TEXTS.long);
        const centred = await wrapBox(page);
        for (const [side, fx, fy] of [["left", -3, 0.5], ["right", 4, 0.5], ["top", 0.5, -3], ["bottom", 0.5, 4]]) {
          await dragGrip(page, fx, fy, kind);
          const g = await wrapBox(page);
          ok(`${at}: dragged to the ${side} edge keeps its width and lines`, near(g.w, centred.w, 1) && g.lines === centred.lines && near(g.text.w, centred.text.w, 1), `${g.w.toFixed(0)}/${g.lines} vs ${centred.w.toFixed(0)}/${centred.lines}`);
        }
        await page.unrouteAll({ behavior: "ignoreErrors" });
        await page.request.delete(`${base}/api/videos/${id}/style`);
        await context.close();
      }
    }

    // Max lines and the font shrink, on one long caption in a narrow box.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    await mockCaptions(page, base, id, [LAYOUT_TEXTS.long]);
    // A text that needs 2-4 lines at full size in this box, on any frame.
    const text = "Stir everything together until it is smooth and then serve it warm";
    await mockCaptions(page, base, id, [text]);
    const measured = {};
    for (const max_lines of [1, 2, 3]) {
      const style = await (await page.request.patch(`${base}/api/videos/${id}/style`, { data: { pos_x: 0.5, pos_y: 0.5, font_size: 54, box_width: 0.5, max_lines } })).json();
      await openMocked(page, base, id);
      await showCaption(page, 0, text);
      measured[max_lines] = await page.evaluate((s) => {
        const frame = document.querySelector("video").parentElement.getBoundingClientRect();
        const size = parseFloat(getComputedStyle(document.querySelector("[data-caption-text]")).fontSize);
        return {
          lines: document.querySelectorAll("[data-caption-line]").length,
          shrink: size / ((s.font_size * frame.height) / s.reference_height / s.font_win_span),
        };
      }, style);
    }
    // Shrunk only when it needs more lines than allowed; never below 70%;
    // past that one extra line, then (at 70%) every line it needs.
    for (const n of [1, 2, 3]) {
      const m = measured[n];
      const legal = m.shrink >= 0.7 - 1e-3 && m.shrink <= 1 + 1e-3 && (m.lines <= n || (m.lines === n + 1) || Math.abs(m.shrink - 0.7) < 1e-3);
      ok(`caption-width: Max lines ${n}: ${m.lines} lines at ${(m.shrink * 100).toFixed(0)}%`, legal, JSON.stringify(m));
    }
    ok("caption-width: fewer lines allowed, smaller font", measured[1].shrink <= measured[2].shrink && measured[2].shrink <= measured[3].shrink && measured[1].shrink < 1, JSON.stringify(measured));
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.close();
  },

  // Snapping: a guide line shows, and the box snaps, when its centre comes
  // near the frame's horizontal or vertical centre; a guide shows at the
  // safe area's edge when the box is pushed against it. Presets and Reset put
  // the box centred inside the safe area. Changes data.
  async "caption-snap"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    await mockCaptions(page, base, id, [LAYOUT_TEXTS.short]);
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.request.patch(`${base}/api/videos/${id}/style`, { data: { pos_x: 0.3, pos_y: 0.3 } });
    await openMocked(page, base, id);
    await showCaption(page, 0, LAYOUT_TEXTS.short);
    const grip = page.getByRole("button", { name: "Move caption" });
    await grip.scrollIntoViewIfNeeded();
    const g0 = await captionGeometry(page);
    const h = await grip.boundingBox();
    const sx = h.x + h.width / 2, sy = h.y + h.height / 2;
    // Aim 5px off the centre lines: within reach of the snap.
    const tx = sx + (g0.frame.x + g0.frame.w / 2 - g0.text.cx) + 5;
    const ty = sy + (g0.frame.y + g0.frame.h / 2 - g0.text.cy) - 5;
    await page.mouse.move(sx, sy); await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 8 });
    await page.waitForTimeout(100);
    const guides = await page.evaluate(() => [...document.querySelectorAll("[data-guide]")].map((e) => e.dataset.guide));
    const g1 = await captionGeometry(page);
    ok("caption-snap: guides show at the centre lines", guides.includes("center-x") && guides.includes("center-y"), guides.join(","));
    ok("caption-snap: the box snaps to the frame's centre", near(g1.text.cx, g1.frame.x + g1.frame.w / 2, 0.6) && near(g1.text.cy, g1.frame.y + g1.frame.h / 2, 0.6), `${(g1.text.cx - g1.frame.x - g1.frame.w / 2).toFixed(1)},${(g1.text.cy - g1.frame.y - g1.frame.h / 2).toFixed(1)}`);
    await page.mouse.move(tx + g0.frame.w * 3, ty, { steps: 8 });
    await page.waitForTimeout(100);
    const edge = await page.evaluate(() => [...document.querySelectorAll("[data-guide]")].map((e) => e.dataset.guide));
    ok("caption-snap: a guide shows at the safe area's edge", edge.includes("safe-right"), edge.join(","));
    await page.mouse.up();
    await page.waitForTimeout(900);
    ok("caption-snap: guides go when the drag ends", (await page.locator("[data-guide]").count()) === 0);

    await page.getByRole("radio", { name: "Position" }).click();
    for (const [label, y] of [["Top", 0.12], ["Middle", 0.5], ["Bottom", 0.88]]) {
      await page.getByRole("radiogroup", { name: "Placement" }).getByRole("radio", { name: label }).click();
      await page.waitForTimeout(900);
      const s = await styleOf(page, base, id);
      const g = await paintedBox(page);
      ok(`caption-snap: ${label} centres the box at ${y}`, s.pos_x === 0.5 && s.pos_y === y && near(g.box.x + g.box.w / 2, g.frame.x + g.frame.w / 2, 1) && insideSafeArea(g), `${s.pos_x},${s.pos_y}`);
    }
    await page.request.patch(`${base}/api/videos/${id}/style`, { data: { pos_x: 0.1, pos_y: 0.1, box_width: 0.3, max_lines: 3 } });
    await page.reload({ waitUntil: "networkidle" });
    // The inspector opens on Captions (v1.1.0); Reset is on the style tabs.
    await page.getByRole("radio", { name: "Position" }).click();
    await page.getByRole("button", { name: "Reset" }).click();
    await page.waitForTimeout(900);
    const reset = await styleOf(page, base, id);
    ok("caption-snap: Reset puts the box back centred at the bottom", reset.pos_x === 0.5 && reset.pos_y === 0.88 && reset.box_width === null && reset.max_lines === 2, JSON.stringify([reset.pos_x, reset.pos_y, reset.box_width, reset.max_lines]));
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.close();
  },

  // Line control in the editor (v1.0.8). Shift+Enter in a caption's text
  // puts a line break there: the preview breaks there, it's saved, and it's
  // still there after a reload (Enter still saves and moves on). The Line
  // style choice works from the keyboard, each option is described to a
  // screen reader, Words per line shows only for Stacked, Max lines offers
  // 1-6 for Stacked and 1-3 otherwise, and the preview restacks. Changes
  // data (one caption's text and the style, both put back).
  async "line-styles"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const id = await editorVideo(page, base);
    await openEditor(page, base, id);
    const captions = await (await page.request.get(`${base}/api/videos/${id}/captions`)).json();
    const target = captions.items.find((c) => c.text.split(" ").length >= 4) ?? captions.items[0];
    const original = target.text;
    const words = original.split(" ");
    await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, (target.start_ms + target.end_ms) / 2000);
    await waitForCaption(page, original);

    // Shift+Enter after the second word.
    const box = page.getByRole("textbox", { name: /^Caption at / }).filter({ hasText: original }).first();
    await box.scrollIntoViewIfNeeded();
    await box.click();
    await box.evaluate((el, at) => { el.setSelectionRange(at, at); }, words.slice(0, 2).join(" ").length);
    await page.keyboard.press("Delete"); // the space the break replaces
    await page.keyboard.press("Shift+Enter");
    ok("line-styles: Shift+Enter keeps the caption open for typing", await box.evaluate((el) => el === document.activeElement));
    const wanted = `${words.slice(0, 2).join(" ")}\n${words.slice(2).join(" ")}`;
    ok("line-styles: Shift+Enter inserts a line break", (await box.inputValue()) === wanted, JSON.stringify(await box.inputValue()));
    await page.keyboard.press("Enter"); // saves and moves on
    await page.waitForTimeout(800);
    const saved = (await (await page.request.get(`${base}/api/videos/${id}/captions`)).json()).items.find((c) => c.id === target.id);
    ok("line-styles: the break is saved", saved.text === wanted, JSON.stringify(saved.text));
    const firstLine = () => page.evaluate(() => document.querySelector("[data-caption-line]")?.textContent);
    await page.waitForFunction((w) => document.querySelector("[data-caption-line]")?.textContent === w, words.slice(0, 2).join(" "), { timeout: 3000 }).catch(() => {});
    ok("line-styles: the preview breaks there", (await firstLine()) === words.slice(0, 2).join(" "), String(await firstLine()));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, (target.start_ms + target.end_ms) / 2000);
    await waitForCaption(page, original);
    ok("line-styles: the break survives a reload", (await firstLine()) === words.slice(0, 2).join(" "), String(await firstLine()));
    await page.request.patch(`${base}/api/captions/${target.id}`, { data: { text: original } });
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await page.evaluate((s) => { const v = document.querySelector("video"); v.pause(); v.currentTime = s; }, (target.start_ms + target.end_ms) / 2000);
    await waitForCaption(page, original);

    // The Line style choice, by keyboard.
    await page.getByRole("radio", { name: "Position" }).click();
    const group = page.getByRole("radiogroup", { name: "Line style" });
    const radios = group.getByRole("radio");
    ok("line-styles: three line styles, Balanced first and chosen", (await radios.count()) === 3 && (await radios.nth(0).getAttribute("aria-checked")) === "true" && (await radios.nth(0).textContent()) === "Balanced");
    for (let i = 0; i < 3; i++) {
      const description = await radios.nth(i).evaluate((el) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
      ok(`line-styles: ${await radios.nth(i).textContent()} is described`, description.length > 20, description);
    }
    await radios.nth(2).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    let style = await styleOf(page, base, id);
    ok("line-styles: Stacked chosen by keyboard, Max lines 4", style.line_style === "stacked" && style.max_lines === 4, `${style.line_style} ${style.max_lines}`);
    const limits = page.getByRole("radiogroup", { name: "Max lines" }).getByRole("radio");
    ok("line-styles: Max lines offers 1-6 when Stacked", (await limits.count()) === 6);
    const wpl = page.getByRole("radiogroup", { name: "Words per line" });
    ok("line-styles: Words per line shows for Stacked", await wpl.isVisible());
    await wpl.getByRole("radio", { name: "1" }).click();
    await page.waitForTimeout(900);
    const stacked = await page.evaluate(() => [...document.querySelectorAll("[data-caption-line]")].map((l) => l.textContent));
    ok("line-styles: one word a line in the preview", stacked.length > 1 && stacked.every((l) => !l.includes(" ")), JSON.stringify(stacked));
    await radios.nth(0).click();
    await page.waitForTimeout(900);
    style = await styleOf(page, base, id);
    ok("line-styles: back to Balanced, Max lines back within 1-3", style.line_style === "balanced" && style.max_lines <= 3 && (await limits.count()) === 3, `${style.line_style} ${style.max_lines}`);
    ok("line-styles: Words per line hidden again", !(await wpl.isVisible()));
    await page.request.delete(`${base}/api/videos/${id}/style`);
    await page.close();
  },

  // The editor and the burn lay a caption out alike: the same lines, and the
  // same painted rectangle (within half a percent of the frame), for every
  // line style, look and size. The burn's layout comes from
  // backend/scripts/caption_layout.py through `docker compose exec`, so this
  // runs on the dev stack only. VCM_LINE_STYLES limits the styles (comma-
  // separated). Changes data.
  async "layout-parity"(browser, base) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const ids = await safeVideos(page, base);
    const texts = Object.values(LAYOUT_TEXTS);
    for (const id of ids) {
      await mockCaptions(page, base, id, texts);
      const styles = (process.env.VCM_LINE_STYLES || Object.keys(LINE_STYLES).join(",")).split(",");
      for (const lineStyle of styles)
      for (const [look, lookFields] of Object.entries(LOOKS)) {
        for (const [size, font_size] of Object.entries(SIZES)) {
          const at = `layout-parity@${id}/${lineStyle}/${look}/${size}`;
          const style = await (await page.request.patch(`${base}/api/videos/${id}/style`, { data: { ...lookFields, ...LINE_STYLES[lineStyle], font_size, pos_x: 0.5, pos_y: 0.5, box_width: null } })).json();
          await openMocked(page, base, id);
          const frame = await page.evaluate(() => ({ width: document.querySelector("video").videoWidth, height: document.querySelector("video").videoHeight }));
          const burn = burnLayout(style, texts, frame);
          const mismatches = [];
          for (const [i, text] of texts.entries()) {
            await showCaption(page, i, text);
            const preview = await page.evaluate(() => {
              const box = document.querySelector("[data-caption-box]");
              const f = document.querySelector("video").parentElement.getBoundingClientRect();
              const s = getComputedStyle(box);
              // The rectangle the layout gave it: the element, plus the
              // outline that the element's own box leaves out.
              const out = s.backgroundColor === "rgba(0, 0, 0, 0)" ? parseFloat(s.webkitTextStrokeWidth || "0") / 2 : 0;
              const r = box.getBoundingClientRect();
              return {
                lines: [...box.querySelectorAll("[data-caption-line]")].map((l) => l.textContent),
                x: (r.x - out - f.x) / f.width, y: (r.y - out - f.y) / f.height,
                width: (r.width + 2 * out) / f.width, height: (r.height + 2 * out) / f.height,
              };
            });
            const want = burn[i];
            const sameLines = JSON.stringify(preview.lines) === JSON.stringify(want.lines);
            const close = ["x", "y", "width", "height"].every((k) => Math.abs(preview[k] - want[k]) < 0.005);
            if (!sameLines || !close) mismatches.push(`${text.slice(0, 12)}…: ${JSON.stringify(preview.lines)} vs ${JSON.stringify(want.lines)}; ${["x", "y", "width", "height"].map((k) => `${k} ${preview[k].toFixed(3)}/${want[k].toFixed(3)}`).join(" ")}`);
          }
          ok(`${at}: same lines and rectangle as the burn`, mismatches.length === 0, mismatches.slice(0, 2).join(" | "));
        }
      }
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await page.request.delete(`${base}/api/videos/${id}/style`);
    }
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
