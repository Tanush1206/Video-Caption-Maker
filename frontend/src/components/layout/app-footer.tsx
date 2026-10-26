"use client";

import { useSystem } from "@/hooks/use-system";

/** "VideoCaptionMaker v1.1.0", small and grey (v1.1.0); the version from the API. */
export function AppFooter() {
  const { data: system } = useSystem();
  const version = system?.version;

  return (
    <footer className="mt-auto px-6 py-6 text-center">
      <p className="text-xs text-muted-foreground">
        VideoCaptionMaker{version && <> {version === "dev" ? "dev" : `v${version}`}</>}
      </p>
    </footer>
  );
}
