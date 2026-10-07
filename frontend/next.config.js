/** @type {import('next').NextConfig} */

// Where the Next server finds the API inside the compose network. Baked in at
// build time (rewrites are compiled into the routes manifest), which is fine:
// the service is called `backend` in every compose file this image runs in.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://backend:8000";

const nextConfig = {
  reactStrictMode: true,
  // A self-contained server.js with only the node_modules it uses, so the
  // runtime image ships no dev dependencies and no build toolchain.
  output: "standalone",
  poweredByHeader: false,
  // Proxied responses are videos and model-sized files; compressing them
  // costs CPU and breaks byte ranges, and nothing here is served over a WAN.
  compress: false,
  experimental: {
    // The default is 30 seconds, and the proxy below carries uploads of up to
    // 2 GB plus the server's probing afterwards. A slow disk would cut the
    // response off and the upload would appear to fail after succeeding.
    proxyTimeout: 30 * 60 * 1000,
  },
  // The browser only ever talks to this server. /api is forwarded to the
  // backend, so an install exposes one port, and the page and its API share
  // an origin: no CORS, no cross-site cookies, nothing to configure.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

module.exports = nextConfig;
