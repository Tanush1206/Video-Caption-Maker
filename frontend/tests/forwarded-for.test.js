// node --test tests/   (no dependencies beyond Next itself)
//
// The audit log's `client` must be the address the frontend actually sees,
// never one a caller wrote into X-Forwarded-For. Each file runs in its own
// process, so loading the preload here doesn't leak into other tests.
require("../forwarded-for");

const assert = require("node:assert/strict");
const http = require("node:http");
const { test } = require("node:test");
const { proxyRequest } = require("next/dist/server/lib/router-utils/proxy-request");

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

// The backend is another process in production, which the preload never
// touches; here it shares this one, so it gets Node's own emit back.
async function listenAsBackend(handler) {
  const server = await listen(handler);
  server.emit = require("node:events").EventEmitter.prototype.emit;
  return server;
}

function get(port, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path: "/api/x", headers }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve(JSON.parse(body)));
    }).on("error", reject);
  });
}

// Echoes the forwarded headers it received, like the backend would read them.
const echo = (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    xff: req.headers["x-forwarded-for"] ?? null,
    proto: req.headers["x-forwarded-proto"] ?? null,
    host: req.headers["x-forwarded-host"] ?? null,
  }));
};

test("a caller-supplied X-Forwarded-For is replaced by the socket's peer", async (t) => {
  const server = await listen(echo);
  t.after(() => server.close());
  const seen = await get(server.address().port, {
    "X-Forwarded-For": "203.0.113.9, 198.51.100.7",
    "X-Forwarded-Proto": "https",
  });
  assert.equal(seen.xff, "127.0.0.1");
  assert.equal(seen.proto, "http");
});

test("a caller-supplied X-Forwarded-Host is replaced by the request's own Host", async (t) => {
  const server = await listen(echo);
  t.after(() => server.close());
  const seen = await get(server.address().port, { "X-Forwarded-Host": "localhost:3000", Host: "evil.example:3000" });
  assert.equal(seen.host, "evil.example:3000");
});

test("a request without X-Forwarded-For gets the peer's address", async (t) => {
  const server = await listen(echo);
  t.after(() => server.close());
  const seen = await get(server.address().port, {});
  assert.equal(seen.xff, "127.0.0.1");
});

test("through Next's rewrite proxy the backend sees the peer, not the caller's value", async (t) => {
  const backend = await listenAsBackend(echo);
  const target = `http://127.0.0.1:${backend.address().port}/api/x`;
  // The same call Next's router makes for an external rewrite (/api/:path*).
  const frontend = await listen((req, res) => {
    proxyRequest(req, res, new URL(target), undefined, undefined, 5000).catch(() => {});
  });
  t.after(() => { frontend.close(); backend.close(); });

  const port = frontend.address().port;
  const seen = await get(port, { "X-Forwarded-For": "203.0.113.9", Host: `localhost:${port}` });
  assert.equal(seen.xff, "127.0.0.1");
  assert.equal(seen.proto, "http");
  // The guard's input is still the Host the browser used.
  assert.equal(seen.host, `localhost:${port}`);
});

test("a rebinding page can't pass for localhost to the API guard through the proxy", async (t) => {
  // DNS rebinding: the page is same-origin with evil.example, so it can send
  // any header, and its Origin matches the host it claims. The backend reads
  // the browser's Host from X-Forwarded-Host; it must get evil.example.
  const backend = await listenAsBackend(echo);
  const target = `http://127.0.0.1:${backend.address().port}/api/videos`;
  const frontend = await listen((req, res) => {
    proxyRequest(req, res, new URL(target), undefined, undefined, 5000).catch(() => {});
  });
  t.after(() => { frontend.close(); backend.close(); });

  const port = frontend.address().port;
  const seen = await get(port, {
    Host: `evil.example:${port}`,
    "X-Forwarded-Host": `localhost:${port}`,
    Origin: `http://localhost:${port}`,
  });
  assert.equal(seen.host, `evil.example:${port}`);
});

test("a listening server never cuts off a request that takes long to arrive", async (t) => {
  const server = await listen(echo);
  t.after(() => server.close());
  // Node's default is five minutes, after which a slow upload is ended.
  assert.equal(server.requestTimeout, 0);
});
