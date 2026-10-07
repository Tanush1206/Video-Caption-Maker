"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";
import type { FontLibraryEntry, FontSearchResult } from "@/types/style";

export const fontKeys = {
  search: (q: string) => ["fonts", "search", q] as const,
};

/** The URL the browser loads a face from — the same file the worker burns with. */
export function fontFileUrl(key: string, weight: "regular" | "bold" = "regular") {
  return `${API_URL}/api/fonts/${key}/${weight}.ttf`;
}

/**
 * Every family matching a query — no page, no cap the user can hit.
 *
 * 2500 is above Google's whole catalogue, so this asks for all of it — matching
 * the server's own ceiling, which exists to stop an unbounded response rather
 * than to withhold anything. The unfiltered reply is a couple of hundred KB of
 * JSON, which is a lot for a dropdown and nothing for a font library; it is
 * fetched once and, because the catalogue is a file committed to the repo, can
 * never go stale while the tab is open. Hence `staleTime: Infinity` — re-running
 * a query the user already ran is pure latency.
 *
 * What made rendering that many rows affordable is the picker windowing them. It
 * was never a JSON problem; it was that a rendered row downloads its own font to
 * preview itself.
 */
export function useFontSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: fontKeys.search(query),
    queryFn: () =>
      api.get<FontSearchResult>(`/api/fonts?q=${encodeURIComponent(query)}&limit=2500`),
    enabled,
    staleTime: Infinity,
  });
}

/**
 * Make a family renderable in this document.
 *
 * The built-in nine have their `@font-face` written in globals.css. Everything
 * from the catalogue cannot — there are 1301 of them and the stylesheet would
 * be megabytes of rules for faces nobody will ever pick. So the rule is added
 * to a single stylesheet at the moment a font is actually needed.
 *
 * Keyed by family and never removed. A face already downloaded costs nothing
 * to leave declared, and dropping the rule when a user tries another font and
 * comes back would re-request the file.
 */
const injected = new Set<string>();

export function useInjectedFontFace(key: string | undefined, family: string | undefined) {
  useEffect(() => {
    if (!key || !family || injected.has(key)) return;
    // `document` is not there during the server render; this hook only ever
    // runs in the browser, but the guard keeps it honest if that changes.
    if (typeof document === "undefined") return;

    injected.add(key);
    const style = document.createElement("style");
    style.dataset.font = key;
    // `swap`, so a caption is never invisible while its font downloads — the
    // first request for an uncached family goes all the way to Google.
    style.textContent = `@font-face{font-family:"${family}";src:url("${fontFileUrl(key)}") format("truetype");font-weight:400;font-style:normal;font-display:swap}`;
    document.head.append(style);
  }, [key, family]);
}

export type { FontLibraryEntry };
