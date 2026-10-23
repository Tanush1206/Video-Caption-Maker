"use client";

import { useHost } from "@/components/layout/engine-chip";
import { useSystem } from "@/hooks/use-system";
import { LOCAL_MODE } from "@/lib/config";

/** One quiet line: where this is running and what it transcribes with. */
export function AppFooter() {
  const host = useHost();
  const { data: system } = useSystem();
  const model = system?.whisper?.model;

  return (
    <footer className="mt-auto px-6 py-6 text-center">
      <p className="text-xs text-muted-foreground">
        VideoCaptionMaker
        {host && <> · {LOCAL_MODE ? "Running locally at " : ""}{host}</>}
        {model && <> · faster-whisper {model}</>}
      </p>
    </footer>
  );
}
