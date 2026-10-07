import { NextResponse, type NextRequest } from "next/server";

import { LOCAL_MODE } from "@/lib/config";

/**
 * A local install has no landing page and no sign-in: opening the app means
 * opening your videos. The account pages still exist for a hosted build.
 */
export function middleware(request: NextRequest) {
  if (!LOCAL_MODE) return NextResponse.next();
  return NextResponse.redirect(new URL("/dashboard", request.url));
}

export const config = { matcher: ["/", "/login", "/register"] };
