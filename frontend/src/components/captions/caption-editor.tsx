"use client";

import { FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { CaptionRow } from "@/components/captions/caption-row";
import {
  EMPHASIS,
  NO_EMPHASIS,
  useDeleteCaption,
  useMergeCaption,
  useSplitCaption,
  useUpdateCaption,
  useVideoCaptions,
} from "@/hooks/use-captions";
import type { Playback } from "@/hooks/use-playback";
import type { Video } from "@/types/video";

interface CaptionEditorProps {
  video: Video;
  playback: Playback;
}

export function CaptionEditor({ video, playback }: CaptionEditorProps) {
  const { data, isLoading, isError, error } = useVideoCaptions(video.id);

  const updateCaption = useUpdateCaption(video.id);
  const splitCaption = useSplitCaption(video.id);
  const mergeCaption = useMergeCaption(video.id);
  const deleteCaption = useDeleteCaption(video.id);

  // Keyboard navigation needs to move focus between rows, which React state
  // can't express — hold the actual DOM nodes.
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  // The row wrappers, separately: scrolling measures the whole row, and the
  // textarea's offset would be off by its padding and timecode column.
  const rows = useRef<(HTMLDivElement | null)[]>([]);
  const list = useRef<HTMLDivElement>(null);

  const focusRow = useCallback((index: number) => {
    const element = inputs.current[index];
    if (!element) return;
    element.focus();
    // Caret to the end, so typing continues rather than overwriting.
    element.setSelectionRange(element.value.length, element.value.length);
  }, []);

  // Warn before leaving with an unsaved edit still in its debounce window.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (updateCaption.isPending) event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [updateCaption.isPending]);

  const captions = data?.items ?? [];
  const { activeCaptionId } = playback;

  /**
   * Keep the caption under the playhead in view.
   *
   * Two guards, both learned the hard way from editors that get this wrong:
   * scrolling the container directly instead of calling scrollIntoView, which
   * would drag the whole page along with it; and standing down entirely while
   * the focus is inside this list, because yanking the view mid-sentence is
   * far worse than letting it fall behind.
   */
  useEffect(() => {
    if (activeCaptionId === null) return;

    const container = list.current;
    if (!container || container.contains(document.activeElement)) return;

    const index = captions.findIndex((caption) => caption.id === activeCaptionId);
    const row = rows.current[index];
    if (!row) return;

    container.scrollTo({
      top: row.offsetTop - container.clientHeight / 2 + row.clientHeight / 2,
      behavior: "smooth",
    });
    // `captions` is deliberately not a dependency: this should fire when the
    // playhead crosses into a new caption, not on every keystroke that edits
    // one. It is only read to find the row, never to decide whether to scroll.
  }, [activeCaptionId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-500">
        Couldn&apos;t load captions: {(error as Error).message}
      </p>
    );
  }

  if (captions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-16 text-center">
        <FileText className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <p className="text-sm font-medium">No captions yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {video.status === "completed"
            ? "Transcription finished but found no speech in this video."
            : "They'll appear here once transcription finishes."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {captions.length} caption{captions.length === 1 ? "" : "s"}
        </span>
        {updateCaption.isPending && (
          <span className="flex items-center gap-1.5 text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </span>
        )}
      </div>

      {/* `relative` so each row's offsetTop is measured against this box, which
          is what the auto-scroll above assumes. */}
      <div
        ref={list}
        className="relative min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto pr-1"
      >
        {captions.map((caption, index) => (
          <CaptionRow
            key={caption.id}
            caption={caption}
            isLast={index === captions.length - 1}
            isActive={caption.id === activeCaptionId}
            registerRef={(element) => {
              inputs.current[index] = element;
            }}
            registerRow={(element) => {
              rows.current[index] = element;
            }}
            onSave={(text) => updateCaption.mutate({ id: caption.id, text })}
            onSeek={() => playback.seekMs(caption.start_ms)}
            onToggleEmphasis={() =>
              updateCaption.mutate({
                id: caption.id,
                ...(caption.override_bold === null ? EMPHASIS : NO_EMPHASIS),
              })
            }
            onSplit={() =>
              splitCaption.mutate({
                id: caption.id,
                // Split where the playhead is if it's inside this caption —
                // you have just watched the exact moment the line should
                // break. Otherwise fall back to the midpoint.
                atMs: splitPoint(caption, playback.currentMs()),
              })
            }
            onMerge={() => mergeCaption.mutate(caption.id)}
            onDelete={() => deleteCaption.mutate(caption.id)}
            onFocusNext={() => focusRow(Math.min(index + 1, captions.length - 1))}
            onFocusPrevious={() => focusRow(Math.max(index - 1, 0))}
          />
        ))}
      </div>

      <p className="mt-3 shrink-0 text-xs text-muted-foreground">
        Enter saves and moves on · Shift+Enter for a line break · Esc discards ·
        Space plays
      </p>
    </div>
  );
}

/** Where to cut: the playhead when it's inside the caption, else the middle. */
function splitPoint(caption: { start_ms: number; end_ms: number }, playheadMs: number) {
  const inside =
    playheadMs > caption.start_ms + 50 && playheadMs < caption.end_ms - 50;
  return Math.round(inside ? playheadMs : (caption.start_ms + caption.end_ms) / 2);
}
