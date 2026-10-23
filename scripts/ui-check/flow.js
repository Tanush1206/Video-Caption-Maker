// The UI's main writes, through the request guard: delete a video from its
// card, change the speech model and back, export SRT and a burned MP4 through
// the Export dialog and download both. Also fails if the guard refuses any of
// the app's own requests (403). Run it at both localhost and 127.0.0.1.
//
// It deletes a video: point it at a test install, never at real data.
//
//   node flow.js <baseUrl> <videoIdToDelete> <videoIdToExport>
const { chromium } = require("playwright");
const [base, deleteId, exportId] = process.argv.slice(2);
if (!base || !deleteId || !exportId) {
  console.error("usage: node flow.js <baseUrl> <videoIdToDelete> <videoIdToExport>");
  process.exit(2);
}
const results = []; const ok = (n, pass, d = "") => results.push(`${pass ? "PASS" : "FAIL"} ${n}${d ? ": " + d : ""}`);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const refused = [];
  p.on("response", (r) => { if (r.url().includes("/api/") && r.status() === 403) refused.push(`${r.request().method()} ${new URL(r.url()).pathname}`); });
  try {
    await p.goto(`${base}/dashboard`, { waitUntil: "networkidle" });
    ok("new UI served", await p.getByRole("link", { name: "Videos" }).first().isVisible());
    const card = p.locator("article", { has: p.locator(`a[href="/editor/${deleteId}"]`) });
    const title = await card.locator("h3").innerText();
    // v1.1.0: delete is in the card's "…" menu, confirmed in a dialog.
    await card.getByRole("button", { name: `More actions for ${title}` }).click();
    await card.getByRole("menuitem", { name: "Delete…" }).click();
    const del = p.waitForResponse((r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/videos/${deleteId}`));
    await p.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();
    const d = await del; await p.waitForTimeout(1500);
    ok("delete", d.status() === 204 && (await p.locator(`a[href="/editor/${deleteId}"]`).count()) === 0, `DELETE ${d.status()}`);

    await p.goto(`${base}/settings`, { waitUntil: "networkidle" });
    const group = p.getByRole("radiogroup", { name: "Speech model" });
    const original = await group.locator("input:checked").getAttribute("value");
    for (const value of [original === "small" ? "auto" : "small", original]) {
      const saved = p.waitForResponse((r) => r.request().method() === "PATCH" && r.url().includes("/api/system/settings"));
      await group.locator(`label:has(input[value="${value}"])`).click();
      const s = await saved; ok(`settings -> ${value}`, s.status() === 200, `PATCH ${s.status()}`); await p.waitForTimeout(400);
    }

    await p.goto(`${base}/editor/${exportId}`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: "Export" }).first().click();
    const dlg = p.getByRole("dialog");
    await dlg.getByRole("radio", { name: /Subtitle file/ }).check({ force: true });
    const n0 = await dlg.getByRole("button", { name: "Download srt" }).count();
    await dlg.getByRole("button", { name: "Export .srt" }).click();
    await p.waitForFunction((n) => document.querySelectorAll('dialog [aria-label="Download srt"]').length > n, n0, { timeout: 60000 });
    let dl = p.waitForEvent("download"); await dlg.getByRole("button", { name: "Download srt" }).first().click();
    ok("export srt", !!(await (await dl).path()));
    const m0 = await dlg.getByRole("button", { name: "Download mp4" }).count();
    await dlg.getByRole("radio", { name: /Burned-in video/ }).check({ force: true });
    await dlg.getByRole("button", { name: "Export .mp4" }).click();
    await p.waitForFunction((n) => { const b = [...document.querySelectorAll('dialog [aria-label="Download mp4"]')]; return b.length > n && !b[0].disabled; }, m0, { timeout: 600000 });
    dl = p.waitForEvent("download"); await dlg.getByRole("button", { name: "Download mp4" }).first().click();
    ok("export mp4", !!(await (await dl).path()), (await dl).suggestedFilename());
  } catch (e) { ok("run", false, e.message.split("\n")[0]); }
  ok("no request refused by the guard", refused.length === 0, refused.join(", "));
  await b.close(); console.log(`== ${base}\n${results.join("\n")}`);
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})();
