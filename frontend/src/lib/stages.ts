"use client";

import { useEffect, useRef, useState } from "react";

import type { Video } from "@/types/video";

/** What each worker stage is called on screen. One table, used everywhere. */
export const STAGE_LABELS: Record<string, string> = {
  downloading: "Downloading model",
  extracting: "Extracting audio",
  transcribing: "Transcribing speech",
  translating: "Translating captions",
  embedding: "Building search index",
};

export function stageLabel(video: Pick<Video, "status" | "stage">): string {
  if (video.status === "pending") return "Waiting to start";
  if (video.stage) return STAGE_LABELS[video.stage] ?? "Working";
  return "Working";
}

function formatEta(seconds: number): string {
  if (seconds < 45) return "less than a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min left`;
}

/**
 * A remaining-time estimate for one stage, from how fast its percentage moves.
 *
 * Measured in the browser rather than reported by the worker: the worker only
 * knows percentages, and the rate it achieves is a fact about this machine
 * that the page can observe directly. Withheld until there is enough of a run
 * to extrapolate from — an estimate from the first 2% is noise that jumps
 * between "1 minute" and "an hour", which is worse than no estimate.
 */
export function useEta(key: string | null, percent: number): string | null {
  const start = useRef<{ key: string; at: number; percent: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!key) {
    start.current = null;
    return null;
  }
  if (!start.current || start.current.key !== key || percent < start.current.percent) {
    start.current = { key, at: now, percent };
    return null;
  }

  const elapsed = (now - start.current.at) / 1000;
  const gained = percent - start.current.percent;
  if (elapsed < 8 || gained < 3 || percent >= 100) return null;

  return formatEta((elapsed / gained) * (100 - percent));
}
