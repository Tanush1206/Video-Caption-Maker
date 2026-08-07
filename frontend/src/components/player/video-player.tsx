"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

import type { Playback } from "@/hooks/use-playback";
import { downloadUrl, streamKeys, streamUrl, useStreamTicket } from "@/hooks/use-stream";
import type { Caption } from "@/types/caption";
import type { Video } from "@/types/video";

interface VideoPlayerProps {
  video: Video;
  playback: Playback;
  /** Drawn over the video so you can see the sync, not just trust it. */
  activeCaption: Caption | null;
}

export function VideoPlayer({ video, playback, activeCaption }: VideoPlayerProps) {
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, isError } = useStreamTicket(video.id);

  // Tracked through the subscription rather than read on demand: by the time
  // an error fires the element may already have reset currentTime to zero.
  const lastTime = useRef(0);
  const resumeAt = useRef<number | null>(null);
  const recovering = useRef(false);

  useEffect(
    () =>
      playback.subscribe((ms) => {
        lastTime.current = ms;
      }),
    [playback]
  );

  /**
   * A stream token outlives an hour of editing but not an afternoon of it.
   * When one expires the browser reports a plain media error, so treat the
   * first error as a stale credential: fetch a new ticket and pick up where
   * playback stopped.
   *
   * The `recovering` latch stops a genuinely corrupt file from looping — it
   * is only cleared once the element actually reaches a playable state.
   */
  function handleError() {
    if (recovering.current) return;
    recovering.current = true;
    resumeAt.current = lastTime.current;
    void queryClient.invalidateQueries({ queryKey: streamKeys.ticket(video.id) });
  }

  function handleLoadedMetadata() {
    if (resumeAt.current === null) return;
    playback.seekMs(resumeAt.current);
    resumeAt.current = null;
  }

  if (isLoading) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-lg bg-black">
        <Loader2 className="h-6 w-6 animate-spin text-white/40" />
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-lg bg-black text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-sm text-white/70">Couldn&apos;t load this video.</p>
      </div>
    );
  }

  const { intrinsic } = playback;

  return (
    <div
      style={{
        // The real aspect ratio, not a hardcoded 16:9 — a portrait or 4:3
        // video would otherwise sit in a letterboxed 16:9 box for no reason.
        aspectRatio: intrinsic ? `${intrinsic.width} / ${intrinsic.height}` : "16 / 9",
        // Never scale past the source's own pixels. Stretching a 640x360 file
        // across an 800px column is upscaling, and it reads as the video
        // having lost quality when nothing was ever re-encoded.
        maxWidth: intrinsic ? `${intrinsic.width}px` : undefined,
      }}
      className="group relative mx-auto w-full overflow-hidden rounded-lg bg-black"
    >
      <video
        ref={playback.attach}
        src={streamUrl(video.id, ticket.token)}
        // Metadata only: the browser learns the duration without pulling down
        // a two-gigabyte file for an editor session that may never press play.
        preload="metadata"
        playsInline
        onClick={playback.toggle}
        onError={handleError}
        onLoadedMetadata={handleLoadedMetadata}
        onCanPlay={() => {
          recovering.current = false;
        }}
        className="h-full w-full cursor-pointer"
      />

      {activeCaption && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 text-center">
          <span className="inline-block max-w-[90%] whitespace-pre-wrap rounded bg-black/70 px-3 py-1.5 text-sm leading-snug text-white">
            {activeCaption.text}
          </span>
        </div>
      )}

      <a
        href={downloadUrl(video.id, ticket.token)}
        title="Download the original file, exactly as uploaded"
        aria-label="Download the original file"
        className="absolute right-2 top-2 rounded-md bg-black/60 p-2 text-white/70 opacity-0 transition hover:bg-black/80 hover:text-white focus:opacity-100 group-hover:opacity-100"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}
