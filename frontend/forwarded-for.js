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
 * address is the peer this server's socket actually has, and the scheme is
 * whether that socket is TLS. Whatever the caller sent is dropped.
 */
const http = require("http");

function overwriteForwarded(req) {
  const socket = req.socket;
  req.headers["x-forwarded-for"] = (socket && socket.remoteAddress) || "";
  req.headers["x-forwarded-proto"] = socket && socket.encrypted ? "https" : "http";
}

const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, ...rest) {
  if ((event === "request" || event === "upgrade") && req && req.headers) {
    overwriteForwarded(req);
  }
  return emit.call(this, event, req, ...rest);
};

module.exports = { overwriteForwarded };
