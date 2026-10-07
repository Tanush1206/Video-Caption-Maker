/**
 * Where the API lives, as the browser sees it.
 *
 * Empty in a production build, so every request is same-origin: the Next
 * server proxies `/api/*` to the backend (see next.config.js), which means an
 * install exposes one port and no CORS or cross-site cookies are involved.
 * The dev compose file sets it to http://localhost:8000.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/**
 * A single-user install on the user's own machine: no login, no account
 * pages, and Settings holds the install's own options instead.
 *
 * Fixed at build time, because it decides what the very first render shows —
 * and a hosted build is a different build anyway. Anything but "accounts"
 * means local, so the default image needs no configuration at all.
 */
export const LOCAL_MODE = (process.env.NEXT_PUBLIC_AUTH_MODE ?? "local") !== "accounts";
