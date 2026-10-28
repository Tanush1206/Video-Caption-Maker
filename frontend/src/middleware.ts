import { NextResponse, type NextRequest } from "next/server";

import { LOCAL_MODE } from "@/lib/config";

const REFUSED = "This request didn't come from VideoCaptionMaker on this computer, so it was refused.";
const THIS_COMPUTER = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Why a request to a local install is refused, or null.
 *
 * The same idea as the API's request guard (backend/app/request_guard.py),
 * one step earlier, so that pages and their data requests are covered too:
 * any web page the user has open can make the browser send requests here
 * (docs/LAUNCH_AUDIT.md S1).
 * - The Host must be this computer, which defeats DNS rebinding.
 * - Another site, or another app on another localhost port, may link here
 *   (a top-level GET navigation) but may not send anything else: no fetches,
 *   no form posts, no scripted requests for server-component payloads.
 * Requests with no Sec-Fetch-Site (scripts, `vcm`, the health check) pass.
 */
function refusal(request: NextRequest): string | null {
  const host = (request.headers.get("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (!THIS_COMPUTER.has(host)) return "host";
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    const navigation = request.method === "GET" && request.headers.get("sec-fetch-mode") === "navigate";
    if (!navigation) return "cross-site";
  }
  return null;
}

/**
 * A local install has no landing page and no sign-in: opening the app means
 * opening your videos. The account pages still exist for a hosted build.
 */
export function middleware(request: NextRequest) {
  if (!LOCAL_MODE) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/_next/image")) {
    return new NextResponse(null, { status: 404 });
  }
  if (refusal(request)) {
    return NextResponse.json({ detail: REFUSED }, { status: 403 });
  }
  if (["/", "/login", "/register"].includes(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

// Everything but the build's static files, which carry no state, and the
// upload, POST /api/videos: the one route with a large body. Since Next 15
// middleware buffers a request's body and keeps only its first 10 MB, which
// broke every larger upload (v1.2.0). The API's own request guard refuses
// other origins, other localhost ports and rebinding Hosts there; the Host it
// reads comes through forwarded-for.js, which no caller can forge.
export const config = { matcher: ["/((?!_next/static|api/videos$).*)"] };
