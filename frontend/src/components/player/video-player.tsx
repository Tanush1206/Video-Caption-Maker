"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import { CaptionOverlay } from "@/components/captions/caption-overlay";
import type { Playback } from "@/hooks/use-playback";
import { streamKeys, streamUrl, useStreamTicket } from "@/hooks/use-stream";
import type { Caption } from "@/types/caption";
import type { CaptionStyle, Font } from "@/types/style";
import type { Video } from "@/types/video";

interface VideoPlayerProps {
  video: Video;
  playback: Playback;
  /** Drawn over the video so you can see the sync, not just trust it. */
  activeCaption: Caption | null;
  /** Undefined until the style loads; the overlay copes by drawing nothing. */
  style: CaptionStyle | undefined;
  font: Font | undefined;
}

export function VideoPlayer({
  video,
  playback,
  activeCaption,
  style,
  font,
}: VideoPlayerProps) {
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, isError } = useStreamTicket(video.id);

  // `?t=` deep link, so a search result opens at the moment it came from.
  // Applied once, on the first metadata load: re-seeking on every render would
  // drag the playhead back the moment anyone scrubbed away from it.
  const searchParams = useSearchParams();
  const deepLinkMs = Number(searchParams.get("t"));
  const deepLinkApplied = useRef(false);

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
    // Recovering from an expired token takes priority: the user was already
    // somewhere, and putting them back beats honouring a stale URL.
    if (resumeAt.current !== null) {
      playback.seekMs(resumeAt.current);
      resumeAt.current = null;
      return;
    }

    if (!deepLinkApplied.current && Number.isFinite(deepLinkMs) && deepLinkMs > 0) {
      deepLinkApplied.current = true;
      playback.seekMs(deepLinkMs);
    }
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
        <AlertTriangle className="h-6 w-6 text-warning" />
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
        // No cap at the source's own width.
        //
        // This used to be `maxWidth: intrinsic.width`, on the reasoning that
        // upscaling a small file reads as lost quality. True, but it is the
        // wrong trade in an editor: a genuinely 256x144 download rendered as a
        // 256px-wide player, and the caption overlay — which scales with the
        // box — became too small to read, in the one view whose entire job is
        // positioning captions on the frame.
        //
        // The transport bar prints the source resolution, which tells the
        // truth about quality without shrinking the workspace to say it.
      }}
      className="relative mx-auto w-full overflow-hidden rounded-lg bg-black"
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

      {/* Getting a file out of this video lives in one place now — the export
          panel, as "Original". A hover-only icon here was a second, separate
          answer to the same question, invisible on a touch screen and easy to
          mistake for "download what I am looking at", captions included. */}
      <CaptionOverlay caption={activeCaption} style={style} font={font} />
    </div>
  );
}
