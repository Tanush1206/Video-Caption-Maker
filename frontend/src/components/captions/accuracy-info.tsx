"use client";

import { Info } from "lucide-react";

import { Popover } from "@/components/ui/popover";

/**
 * What to expect of the captions, behind an (i) next to the caption count
 * and next to "Spoken audio" (v1.2.1). Only on click, never shown by itself.
 */
export function AccuracyInfo({ className }: { className?: string }) {
  return (
    <Popover
      label="About caption accuracy"
      panelLabel="About caption accuracy"
      trigger={<Info className="size-4" aria-hidden="true" />}
      side="bottom"
      align="start"
      className={className}
      triggerClassName="text-muted-foreground hover:text-foreground"
      panelClassName="w-[min(18rem,calc(100vw-2rem))] p-3 outline-none"
    >
      {() => (
        <p className="text-[13px] leading-5 text-foreground">
          Captions are made by AI speech recognition, so some words may be wrong, especially names, technical
          terms, mixed Hindi and English, fast speech or background noise. Read through your captions before
          exporting. Click any caption to fix it.
        </p>
      )}
    </Popover>
  );
}
