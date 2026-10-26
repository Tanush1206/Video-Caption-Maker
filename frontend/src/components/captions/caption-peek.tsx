"use client";

import { useEffect, useRef, useState } from "react";

import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Caption } from "@/types/caption";

const AUTOSAVE_DELAY_MS = 800;

/**
 * The phone sheet's peek (v1.1.0): the caption under the playhead, its time
 * and its text, in the space between the timeline and the sheet's tools. A
 * tap on the text edits it right there, with the video still in view; it
 * saves as a list row does (debounced, and on leaving the field).
 *
 * While the field has focus it holds on to the caption being edited, so the
 * playhead moving on doesn't swap the text out from under the typing.
 */
export function CaptionPeek({
  caption,
  onSave,
}: {
  caption: Caption | null;
  onSave: (id: number, text: string) => void;
}) {
  const [held, setHeld] = useState<Caption | null>(null);
  const shown = held ?? caption;

  if (!shown) {
    return (
      <p className="flex min-h-[72px] items-center px-4 text-[15px] text-muted-foreground">
        No caption at this moment.
      </p>
    );
  }

  return (
    <PeekField
      // A fresh field per caption: its draft never leaks into the next one.
      key={shown.id}
      caption={shown}
      onSave={(text) => onSave(shown.id, text)}
      onFocus={() => setHeld(shown)}
      onBlur={() => setHeld(null)}
    />
  );
}

function PeekField({
  caption,
  onSave,
  onFocus,
  onBlur,
}: {
  caption: Caption;
  onSave: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const [text, setText] = useState(caption.text);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow the server (the list, a Redo) unless mid-edit.
  useEffect(() => {
    if (!dirty) setText(caption.text);
  }, [caption.text, dirty]);

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

  function flush() {
    if (!dirty) return;
    if (timer.current) clearTimeout(timer.current);
    onSave(text);
    setDirty(false);
  }

  return (
    <div className="min-h-[72px] px-4 py-2">
      <p className="font-mono text-xs leading-4 tabular-nums text-primary">
        {formatTimecode(caption.start_ms)}
        <span aria-hidden="true"> → </span>
        <span className="sr-only">to</span>
        {formatTimecode(caption.end_ms)}
      </p>
      <textarea
        value={text}
        rows={2}
        onChange={(event) => {
          setText(event.target.value);
          setDirty(true);
        }}
        onFocus={onFocus}
        onBlur={() => {
          flush();
          onBlur();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setText(caption.text);
            setDirty(false);
          }
        }}
        aria-label={`Current caption, at ${formatTimecode(caption.start_ms)}`}
        className={cn(
          // Reads as text until it is tapped.
          "-mx-1.5 mt-1 block w-[calc(100%+0.75rem)] resize-none rounded-md border bg-transparent px-1.5 py-0 text-[17px] leading-6",
          "transition-colors duration-200 ease-out focus:border-ring focus:bg-background focus:outline-none",
          dirty ? "border-accent/60" : "border-transparent"
        )}
      />
    </div>
  );
}
