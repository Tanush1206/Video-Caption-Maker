"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

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

/** How long a download may take before saying so: a cached face never flashes the message. */
const DOWNLOAD_NOTICE_MS = 300;

export type FontDownload = "downloading" | "failed" | null;

/**
 * Fetch a catalogue face's files the moment it is chosen, and say how it went.
 *
 * The first request for a face makes the server download it from Google,
 * which takes seconds; until then the preview draws the caption in a fallback
 * face. Fetching here, through the same URL the preview's @font-face uses,
 * puts the file in the browser's cache for it and tells the panel whether it
 * arrived. A bold face the family doesn't have (404) is not a failure: the
 * caption is then drawn in the regular one.
 *
 * `onArrived` runs once the files are there, for whatever was measured from
 * them on the server.
 */
export function useFontDownload(onArrived: (key: string) => void) {
  const [state, setState] = useState<FontDownload>(null);
  const latest = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const start = useCallback(
    (key: string, bold: boolean) => {
      latest.current = key;
      stop();
      setState(null);
      timer.current = setTimeout(() => setState("downloading"), DOWNLOAD_NOTICE_MS);
      const weights = bold ? (["regular", "bold"] as const) : (["regular"] as const);
      Promise.all(
        weights.map((weight) =>
          fetch(fontFileUrl(key, weight))
            .then((response) => response.ok || (weight === "bold" && response.status === 404))
            .catch(() => false)
        )
      ).then((results) => {
        if (latest.current !== key) return;
        stop();
        const arrived = results.every(Boolean);
        setState(arrived ? null : "failed");
        if (arrived) onArrived(key);
      });
    },
    [onArrived]
  );

  /** A built-in face was chosen instead: nothing to download, nothing to say. */
  const clear = useCallback(() => {
    latest.current = null;
    stop();
    setState(null);
  }, []);

  useEffect(() => stop, []);

  return { state, start, clear };
}

export type { FontLibraryEntry };
