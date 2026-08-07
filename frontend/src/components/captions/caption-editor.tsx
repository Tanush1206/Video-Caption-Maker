"use client";

import { FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { CaptionRow } from "@/components/captions/caption-row";
import {
  useDeleteCaption,
  useMergeCaption,
  useSplitCaption,
  useUpdateCaption,
  useVideoCaptions,
} from "@/hooks/use-captions";
import type { Video } from "@/types/video";

export function CaptionEditor({ video }: { video: Video }) {
  const { data, isLoading, isError, error } = useVideoCaptions(video.id);

  const updateCaption = useUpdateCaption(video.id);
  const splitCaption = useSplitCaption(video.id);
  const mergeCaption = useMergeCaption(video.id);
  const deleteCaption = useDeleteCaption(video.id);

  // Keyboard navigation needs to move focus between rows, which React state
  // can't express — hold the actual DOM nodes.
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);

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

  const captions = data?.items ?? [];

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
    <div>
      <div className="mb-3 flex items-center justify-between text-sm text-muted-foreground">
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

      <div className="divide-y divide-border/50">
        {captions.map((caption, index) => (
          <CaptionRow
            key={caption.id}
            caption={caption}
            isLast={index === captions.length - 1}
            registerRef={(element) => {
              inputs.current[index] = element;
            }}
            onSave={(text) => updateCaption.mutate({ id: caption.id, text })}
            onSplit={() =>
              splitCaption.mutate({
                id: caption.id,
                // Midpoint: without word-level timings there's no better
                // guess, and the user can drag the boundary afterwards.
                atMs: Math.round((caption.start_ms + caption.end_ms) / 2),
              })
            }
            onMerge={() => mergeCaption.mutate(caption.id)}
            onDelete={() => deleteCaption.mutate(caption.id)}
            onFocusNext={() => focusRow(Math.min(index + 1, captions.length - 1))}
            onFocusPrevious={() => focusRow(Math.max(index - 1, 0))}
          />
        ))}
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Enter saves and moves to the next caption · Shift+Enter for a line break ·
        Esc discards
      </p>
    </div>
  );
}
