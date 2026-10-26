"use client";

import { useState } from "react";

import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";

export type InspectorTab = "captions" | "typography" | "appearance" | "position";

const TABS = [
  { value: "captions" as const, label: "Captions" },
  { value: "typography" as const, label: "Typography" },
  { value: "appearance" as const, label: "Appearance" },
  { value: "position" as const, label: "Position" },
];

/**
 * The editor's inspector (v1.1.0): one segmented control over the panes it
 * switches between, like an Apple app's inspector. The captions list and the
 * three style panes stay mounted and are only hidden, so a list scrolled to
 * the playhead or a colour picker mid-edit survives a look at another tab.
 *
 * A sidebar from lg up. On a phone it is a bottom sheet: lowered, it peeks
 * (`peek`: the caption under the playhead, editable in place) above the
 * control; choosing a tab (or the grabber) raises the sheet, and the grabber
 * lowers it again so the video and timeline are in view.
 *
 * The control keeps the radio semantics the tools always had ("Editor
 * tools"): one setting with four values, arrow keys between them.
 */
export function Inspector({
  tab,
  onTab,
  children,
  peek,
  className,
}: {
  tab: InspectorTab;
  onTab: (tab: InspectorTab) => void;
  /** The captions list, and the style panel the three style tabs share. */
  children: { captions: React.ReactNode; style: React.ReactNode };
  /** Shown on a phone while the sheet is lowered. */
  peek?: React.ReactNode;
  className?: string;
}) {
  const [raised, setRaised] = useState(false);

  return (
    <aside
      aria-label="Inspector"
      className={cn(
        "flex min-h-0 flex-col",
        // Phone: a sheet on the bottom edge, translucent, the floating shadow.
        "max-lg:bar-translucent max-lg:z-40 max-lg:rounded-t-2xl max-lg:shadow-overlay max-lg:pb-[env(safe-area-inset-bottom)]",
        // In dark a shadow doesn't show on black: the sheet is the raised surface.
        "max-lg:dark:bg-card/[0.86]",
        raised
          ? "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:h-[72vh]"
          : // Lowered: in the flow after the timeline, filling what is left
            // of the screen (no gap above it, no overlap on a short phone),
            // held on the bottom edge while the page scrolls.
            "max-lg:sticky max-lg:bottom-0 max-lg:order-last max-lg:flex-1",
        className
      )}
    >
      <div className={cn("shrink-0 px-4 pb-3 pt-2 lg:px-5 lg:pt-4", !raised && "max-lg:flex max-lg:flex-1 max-lg:flex-col")}>
        <button
          type="button"
          onClick={() => setRaised((value) => !value)}
          aria-expanded={raised}
          aria-label={raised ? "Lower the inspector" : "Raise the inspector"}
          className="mx-auto mb-2 flex h-6 w-16 items-center justify-center lg:hidden"
        >
          <span className="h-1 w-9 rounded-full bg-muted-foreground/40" aria-hidden="true" />
        </button>
        {peek && !raised && <div className="-mx-4 mb-2 flex-1 lg:hidden">{peek}</div>}
        <Segmented
          kind="radio"
          label="Editor tools"
          segments={TABS}
          value={tab}
          onChange={(next) => {
            onTab(next);
            setRaised(true);
          }}
          segmentClassName="px-1.5 text-[13px]"
        />
      </div>

      <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-6 lg:px-5", !raised && "max-lg:hidden")}>
        <div className={cn("h-full", tab !== "captions" && "hidden")}>{children.captions}</div>
        <div className={cn("pt-1", tab === "captions" && "hidden")}>{children.style}</div>
      </div>
    </aside>
  );
}
