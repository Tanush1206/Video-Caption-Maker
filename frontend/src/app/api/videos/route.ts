/**
 * /api/videos, forwarded to the API by hand: the upload (POST) and the list
 * (GET), the one route with a large body.
 *
 * Every other /api path goes through the rewrite in next.config.js. That
 * proxy copies the request body as it passes, and keeps the copy: Next 14
 * held a whole upload in memory (a 192 MB upload took the server from 34 to
 * 241 MiB), and Next 15 keeps only the first 10 MB, which cut every larger
 * upload off (v1.2.0). A route handler is matched before the rewrite and
 * reads the request itself, so the upload streams through with backpressure,
 * in constant memory, at any size.
 *
 * Node's `http`, not `fetch`: fetch's own timeouts (five minutes for the
 * reply's headers) would fail a long upload whose server still has to probe
 * it. Here only a connection that goes quiet for IDLE_MS is given up on, the
 * same 30 minutes the rewrite proxy allows.
 *
 * The middleware skips this path (src/middleware.ts): run, it would copy the
 * body too. The API's own guard refuses other origins, other localhost ports
 * and rebinding Hosts; the Host it reads arrives in X-Forwarded-Host, which
 * forwarded-for.js sets from the request and no caller can forge.
 */
import http from "node:http";
import { Readable, pipeline } from "node:stream";

export const dynamic = "force-dynamic";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://backend:8000";
const IDLE_MS = 30 * 60 * 1000;

/** Headers about this one connection, never passed on (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailer", "transfer-encoding", "upgrade", "host",
]);

const UNAVAILABLE = "The app's server isn't answering. Run vcm restart, then try again.";

function forward(request: Request): Promise<Response> {
  const target = new URL(`/api/videos${new URL(request.url).search}`, BACKEND_URL);
  const headers: Record<string, string> = {};
  request.headers.forEach((value, name) => {
    if (!HOP_BY_HOP.has(name)) headers[name] = value;
  });

  return new Promise((resolve) => {
    const upstream = http.request(target, { method: request.method, headers, timeout: IDLE_MS }, (reply) => {
      const out = new Headers();
      for (const [name, value] of Object.entries(reply.headers)) {
        if (value === undefined || HOP_BY_HOP.has(name)) continue;
        for (const one of Array.isArray(value) ? value : [value]) out.append(name, one);
      }
      resolve(new Response(Readable.toWeb(reply) as ReadableStream, { status: reply.statusCode ?? 502, headers: out }));
    });
    upstream.on("timeout", () => upstream.destroy(new Error("the API went quiet")));
    upstream.on("error", () =>
      resolve(Response.json({ detail: UNAVAILABLE }, { status: 502 }))
    );
    // The browser gave up (Cancel, a closed tab): so does the API's request,
    // and the API drops what it had received.
    request.signal.addEventListener("abort", () => upstream.destroy());

    if (request.body) {
      pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), upstream, (error) => {
        if (error) upstream.destroy();
      });
    } else {
      upstream.end();
    }
  });
}

export const GET = forward;
export const POST = forward;
