"use client";

import { CornerRightDown, Highlighter, Scissors, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { formatTimecode } from "@/lib/format";
import type { Caption } from "@/types/caption";


/** The row's tools: plain grey icons, 44 px on a phone, 24 px on the time
    line from sm up so they don't make the row taller. */
const ICON_BUTTON =
  "flex size-11 items-center justify-center rounded-full transition-colors duration-200 ease-out hover:bg-surface-3 sm:size-6 [&_svg]:size-4 sm:[&_svg]:size-3.5";

/** Whisper's avg_logprob; below this the line is usually worth checking. */
const LOW_CONFIDENCE = -1.0;

const AUTOSAVE_DELAY_MS = 800;

interface CaptionRowProps {
  caption: Caption;
  isLast: boolean;
  /** True while the playhead is inside this caption's time range. */
  isActive: boolean;
  onSave: (text: string) => void;
  onSplit: () => void;
  onMerge: () => void;
  onDelete: () => void;
  onSeek: () => void;
  onToggleEmphasis: () => void;
  onFocusNext: () => void;
  onFocusPrevious: () => void;
  registerRef: (element: HTMLTextAreaElement | null) => void;
  registerRow: (element: HTMLDivElement | null) => void;
}

export function CaptionRow({
  caption,
  isLast,
  isActive,
  onSave,
  onSplit,
  onMerge,
  onDelete,
  onSeek,
  onToggleEmphasis,
  onFocusNext,
  onFocusPrevious,
  registerRef,
  registerRow,
}: CaptionRowProps) {
  const [text, setText] = useState(caption.text);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Accept server changes (a re-transcribe, or another tab) unless the user
  // is mid-edit — clobbering someone's unsaved typing is worse than being
  // briefly stale.
  useEffect(() => {
    if (!dirty) setText(caption.text);
  }, [caption.text, dirty]);

  // Debounced autosave. Saving on every keystroke would be a request per
  // character; saving only on blur loses work if the tab closes.
  useEffect(() => {
    if (!dirty) return;

    timer.current = setTimeout(() => {
      onSave(text);
      setDirty(false);
    }, AUTOSAVE_DELAY_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [text, dirty, onSave]);

  const flush = () => {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    onSave(text);
    setDirty(false);
  };

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter saves and moves on; Shift+Enter inserts a newline, as in any
    // editor. Without this, Enter would just add invisible whitespace to a
    // subtitle line.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      flush();
      onFocusNext();
      return;
    }
    if (event.key === "ArrowDown" && event.metaKey) {
      event.preventDefault();
      onFocusNext();
    }
    if (event.key === "ArrowUp" && event.metaKey) {
      event.preventDefault();
      onFocusPrevious();
    }
    if (event.key === "Escape") {
      setText(caption.text);
      setDirty(false);
    }
  }

  const lowConfidence =
    caption.confidence !== null && caption.confidence < LOW_CONFIDENCE;

  // Any override at all counts. The three are set and cleared together by the
  // toggle, but a caption edited through the API might carry only one.
  const emphasised =
    caption.override_color !== null ||
    caption.override_bold !== null ||
    caption.override_scale !== null;

  return (
    // A row per caption (v1.1.0): dense, the list draws hairlines between
    // rows, and the one under the playhead sits on the grouped grey with its
    // time in the accent.
    <div
      ref={registerRow}
      className={cn(
        "group relative px-3 py-2 transition-colors duration-200 ease-out",
        isActive ? "bg-surface-2" : "hover:bg-surface-2/50"
      )}
    >
      {/* 16 px from sm up, the tools overhanging it; a phone's 44 px tools
          need the room. */}
      <div className="flex items-center justify-between gap-2 max-sm:min-h-11 sm:h-4">
        <button
          type="button"
          onClick={onSeek}
          title="Jump the video here"
          className={cn(
            "flex items-center gap-1 rounded-sm font-mono text-xs leading-4 tabular-nums transition-colors duration-200 ease-out hover:text-primary",
            isActive ? "text-primary" : "text-muted-foreground"
          )}
        >
          {formatTimecode(caption.start_ms)}
          <span aria-hidden="true">→</span>
          <span className="sr-only">to</span>
          {formatTimecode(caption.end_ms)}
        </button>

        {lowConfidence && (
          <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground group-hover:hidden">
            <span className="size-2 rounded-full bg-warning" aria-hidden="true" />
            Check this line
          </span>
        )}

        {/* Always visible on the active row: it is the one you are editing, so
            its actions should not require a hover to find. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100",
            isActive ? "opacity-100" : "opacity-0"
          )}
        >
        <button
          type="button"
          onClick={onToggleEmphasis}
          aria-pressed={emphasised}
          title={emphasised ? "Remove emphasis" : "Emphasise this caption"}
          aria-label="Toggle emphasis"
          className={cn(
            ICON_BUTTON,
            emphasised ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Highlighter className="size-4" />
        </button>
        <button
          type="button"
          onClick={onSplit}
          title="Split at midpoint"
          aria-label="Split caption"
          className={cn(ICON_BUTTON, "text-muted-foreground hover:text-foreground")}
        >
          <Scissors className="size-4" />
        </button>
        <button
          type="button"
          onClick={onMerge}
          disabled={isLast}
          title={isLast ? "No caption after this one" : "Merge with next"}
          aria-label="Merge with next caption"
          className={cn(ICON_BUTTON, "text-muted-foreground hover:text-foreground disabled:opacity-30")}
        >
          <CornerRightDown className="size-4" />
        </button>
        <button
          type="button"
          onClick={onDelete}
          title="Delete caption"
          aria-label="Delete caption"
          className={cn(ICON_BUTTON, "text-muted-foreground hover:text-destructive")}
        >
          <Trash2 className="size-4" />
        </button>
        </div>
      </div>

      <textarea
        ref={registerRef}
        value={text}
        // Each manual line break (Shift+Enter) starts a row of its own.
        rows={Math.max(1, text.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 48)), 0))}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
        onBlur={flush}
        onKeyDown={handleKeyDown}
        className={cn(
          // Reads as text, not a form field, until it is touched: DESIGN.md's
          // "transparent background and seamless borders".
          "-mx-1.5 mt-0.5 block w-[calc(100%+0.75rem)] resize-none rounded-md border bg-transparent px-1.5 py-0 text-[15px] leading-[22px] transition-colors duration-200 ease-out",
          "hover:border-border focus:border-ring focus:bg-background focus:outline-none",
          dirty ? "border-accent/60" : "border-transparent"
        )}
        aria-label={`Caption at ${formatTimecode(caption.start_ms)}`}
      />

      {lowConfidence && <span className="sr-only">Low confidence: worth checking.</span>}
    </div>
  );
}
