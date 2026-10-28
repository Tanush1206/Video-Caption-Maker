/**
 * Preloaded into the Next server (`node -r ./forwarded-for.js server.js`).
 *
 * The backend believes X-Forwarded-For/-Proto from this container only
 * (backend/app/proxy_headers.py), so this server must never pass a caller's
 * values along. Next's /api rewrite proxy forwards the incoming headers as they
 * are and only adds X-Forwarded-For when it is missing, which lets anyone who
 * can reach the UI port write any address into the backend's audit.log.
 *
 * So every request is rewritten as it arrives, before Next sees it: the
 * address is the peer this server's socket actually has, the scheme is
 * whether that socket is TLS, and the host is the request's own Host header.
 * Whatever the caller sent is dropped.
 *
 * The host matters as much as the address: behind this proxy the backend's
 * request guard reads the browser's Host from X-Forwarded-Host (Next's proxy
 * passes a caller's value on as it is), and on /api/videos, which the
 * middleware's own Host check doesn't cover (v1.2.0, see src/middleware.ts),
 * it is what refuses a DNS-rebinding page.
 */
const http = require("http");

function overwriteForwarded(req) {
  const socket = req.socket;
  req.headers["x-forwarded-for"] = (socket && socket.remoteAddress) || "";
  req.headers["x-forwarded-proto"] = socket && socket.encrypted ? "https" : "http";
  req.headers["x-forwarded-host"] = req.headers.host || "";
}

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
  if ((event === "request" || event === "upgrade") && req && req.headers) {
    overwriteForwarded(req);
  }
  if (event === "listening") {
    // Node ends any request still arriving after five minutes
    // (`requestTimeout`), and Next leaves it at that: a large upload over a
    // slow disk or a throttled connection was cut off. Off for this server,
    // which only this computer can reach; an upload that stalls is still
    // ended by /api/videos' idle timeout (src/app/api/videos/route.ts).
    this.requestTimeout = 0;
  }
  return emit.call(this, event, req, ...rest);
};

module.exports = { overwriteForwarded };
