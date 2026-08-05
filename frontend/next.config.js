/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Docker dev server needs to bind to all interfaces to be reachable
  // from the host — handled via `next dev` default in the container.
};

module.exports = nextConfig;
