// node --test tests/
//
// Every page and API response carries the headers that stop another site
// from framing the app (clickjacking) or sniffing a response into something
// else (docs/SECURITY.md §3a). Loaded as a production build sees the config.
// Each test file runs in its own process, so setting NODE_ENV here is local.
process.env.NODE_ENV = "production";
delete process.env.NEXT_PUBLIC_API_URL;

const assert = require("node:assert/strict");
const { test } = require("node:test");

const config = require("../next.config.js");

async function headersFor(source) {
  const rule = (await config.headers()).find((r) => r.source === source);
  assert.ok(rule, `no header rule for ${source}`);
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key.toLowerCase(), value]));
}

test("every route refuses to be framed by anyone", async () => {
  const headers = await headersFor("/:path*");
  assert.match(headers["content-security-policy"], /(^|; )frame-ancestors 'none'(;|$)/);
  assert.equal(headers["x-frame-options"], "DENY");
});

test("responses are never sniffed or sent with a referrer to other sites", async () => {
  const headers = await headersFor("/:path*");
  assert.equal(headers["x-content-type-options"], "nosniff");
  // same-origin, not no-referrer: no-referrer makes the browser send
  // `Origin: null` with the app's own writes, which the API refuses.
  assert.equal(headers["referrer-policy"], "same-origin");
});

test("a production page may load only from this server", async () => {
  const csp = (await headersFor("/:path*"))["content-security-policy"];
  for (const directive of ["default-src", "img-src", "media-src", "font-src", "connect-src"]) {
    const sources = csp.split("; ").find((d) => d.startsWith(`${directive} `)).split(" ").slice(1);
    for (const source of sources) {
      assert.ok(["'self'", "blob:", "data:"].includes(source), `${directive} allows ${source}`);
    }
  }
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(csp, /object-src 'none'/);
});

test("the image optimiser is switched off", () => {
  assert.equal(config.images.unoptimized, true);
});
