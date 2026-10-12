"use client";

import { useHost } from "@/components/layout/engine-chip";
import { useSystem } from "@/hooks/use-system";
import { LOCAL_MODE } from "@/lib/config";

/** One mono line: where this is running and what it transcribes with. */
export function AppFooter() {
  const host = useHost();
  const { data: system } = useSystem();
  const model = system?.whisper?.model;

  return (
    <footer className="mt-auto border-t border-border px-6 py-3 text-center">
      <p className="font-mono text-[11px] text-muted-foreground">
        VideoCaptionMaker
        {host && <> · {LOCAL_MODE ? "Running locally at " : ""}{host}</>}
        {model && <> · faster-whisper {model}</>}
      </p>
    </footer>
  );
}
