/** @type {import('next').NextConfig} */

// Where the Next server finds the API inside the compose network. Baked in at
// build time (rewrites are compiled into the routes manifest), which is fine:
// the service is called `backend` in every compose file this image runs in.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://backend:8000";

// Where the browser calls the API from: this server's own /api in a build,
// another port in development (NEXT_PUBLIC_API_URL).
const API_ORIGIN = (() => {
  try {
    return process.env.NEXT_PUBLIC_API_URL ? new URL(process.env.NEXT_PUBLIC_API_URL).origin : "";
  } catch {
    return "";
  }
})();
const DEVELOPMENT = process.env.NODE_ENV !== "production";

/**
 * What a page may load and who may frame it (docs/SECURITY.md §3a).
 *
 * Everything comes from this server. `frame-ancestors 'none'` is the part
 * that matters most: framed by another site, the app's own clicks are
 * same-origin, so the API's request guard would let a hidden Delete through.
 * Inline scripts are allowed because Next 14's App Router writes its
 * bootstrap inline (no nonces); development adds the API's port, eval for
 * the dev tooling and the hot-reload socket.
 */
function contentSecurityPolicy() {
  const own = ["'self'", API_ORIGIN].filter(Boolean).join(" ");
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${DEVELOPMENT ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${own} blob: data:`,
    `media-src ${own} blob:`,
    `font-src ${own} data:`,
    `connect-src ${own}${DEVELOPMENT ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Not "no-referrer": under it a browser sends `Origin: null` with the app's
  // own POST/PATCH/DELETE, and the request guard refuses a null origin.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig = {
  reactStrictMode: true,
  // The app never uses next/image. Unoptimized removes the /_next/image
  // endpoint, which any page in the browser could otherwise call
  // (docs/LAUNCH_AUDIT.md S1).
  images: { unoptimized: true },
  // A self-contained server.js with only the node_modules it uses, so the
  // runtime image ships no dev dependencies and no build toolchain.
  output: "standalone",
  poweredByHeader: false,
  // Proxied responses are videos and model-sized files; compressing them
  // costs CPU and breaks byte ranges, and nothing here is served over a WAN.
  compress: false,
  experimental: {
    // The default is 30 seconds, and the proxy below carries uploads of up to
    // 4 GB plus the server's probing afterwards. A slow disk would cut the
    // response off and the upload would appear to fail after succeeding.
    proxyTimeout: 30 * 60 * 1000,
  },
  // The browser only ever talks to this server. /api is forwarded to the
  // backend, so an install exposes one port, and the page and its API share
  // an origin: no CORS, no cross-site cookies, nothing to configure.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

module.exports = nextConfig;
