"use client";

import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";

import { Segmented } from "@/components/ui/segmented";
import type { Playback } from "@/hooks/use-playback";
import { PLAYBACK_RATES } from "@/hooks/use-playback";
import { formatTimecode } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The playhead clock.
 *
 * Its own component, and it writes textContent directly, because this is the
 * one piece of the UI that genuinely changes sixty times a second. Holding the
 * time in React state instead would re-render the whole editor on every frame.
 */
function PlaybackClock({ playback }: { playback: Playback }) {
  const output = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      playback.subscribe((ms) => {
        if (output.current) output.current.textContent = formatTimecode(ms);
      }),
    [playback]
  );

  return (
    <span
      className="font-mono text-sm tabular-nums text-foreground"
      ref={output}
    >
      00:00.000
    </span>
  );
}

// Plain icons: the screen's one filled button is Export.
const buttonClass =
  "flex size-11 items-center justify-center rounded-full text-foreground transition-colors duration-200 ease-out hover:bg-surface-3 sm:size-9";

interface PlayerControlsProps {
  playback: Playback;
  /**
   * Whether the file has a decodable audio track at all, per the waveform.
   * null while that's still being worked out. Worth showing: "I hear nothing"
   * has two very different causes, and only one of them is the volume.
   */
  hasAudioTrack: boolean | null;
}

export function PlayerControls({ playback, hasAudioTrack }: PlayerControlsProps) {
  const silent = playback.isMuted || playback.volume === 0;

  return (
    <div className="mt-3 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 sm:grid-cols-[1fr_auto_1fr]">
      {/* Three explicit columns rather than a flex row: the transport stays
          optically centred no matter how wide the timecode or the speed
          buttons get, which a flex row with ml-auto cannot guarantee. */}
      <div className="flex min-w-0 items-baseline gap-1.5">
        <PlaybackClock playback={playback} />
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          / {formatTimecode(playback.durationMs)}
        </span>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => playback.stepFrames(-1)}
          title="Previous frame (,)"
          aria-label="Step back one frame"
          className={buttonClass}
        >
          <ChevronLeft className="size-4" />
        </button>

        <button
          type="button"
          onClick={playback.toggle}
          aria-label={playback.isPlaying ? "Pause" : "Play"}
          className="flex size-11 items-center justify-center rounded-full text-foreground transition-colors duration-200 ease-out hover:bg-surface-3"
        >
          {playback.isPlaying ? (
            <Pause className="size-6 fill-current" />
          ) : (
            <Play className="size-6 translate-x-px fill-current" />
          )}
        </button>

        <button
          type="button"
          onClick={() => playback.stepFrames(1)}
          title="Next frame (.)"
          aria-label="Step forward one frame"
          className={buttonClass}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Its own row on a phone: time, transport and speed do not fit one
          375px line, and wrapping is better than a sideways-scrolling page. */}
      <div className="col-span-2 flex items-center justify-between gap-2 sm:col-span-1 sm:justify-end">
        {/* The <video> is rendered without native controls, so this is the only
            way to reach volume at all — and a muted player has to be obvious,
            not a subtly different icon. */}
        {hasAudioTrack === false ? (
          <span
            title="FFmpeg found no audio stream in this file"
            className="flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            <VolumeX className="size-4" />
            <span className="hidden sm:inline">No audio</span>
          </span>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={playback.toggleMute}
              aria-label={playback.isMuted ? "Unmute" : "Mute"}
              aria-pressed={playback.isMuted}
              className={cn(buttonClass, silent && "text-destructive")}
            >
              {silent ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={playback.isMuted ? 0 : playback.volume}
              onChange={(event) => playback.changeVolume(Number(event.target.value))}
              aria-label="Volume"
              className="hidden w-16 accent-[hsl(var(--accent))] sm:block"
            />
          </div>
        )}

      {/* The source's real pixel size. Shown because "the video looks worse
          than my original" is otherwise unanswerable — nothing here re-encodes
          video, so this is exactly what was uploaded. */}
      {playback.intrinsic && (
        <span
          title="Source resolution — the file is served exactly as uploaded"
          className="hidden text-sm tabular-nums text-muted-foreground xl:inline"
        >
          {playback.intrinsic.width}&times;{playback.intrinsic.height}
        </span>
      )}

        {/* One setting with four positions: a segmented control. */}
        <Segmented
          label="Playback speed"
          segments={PLAYBACK_RATES.map((rate) => ({ value: rate, label: `${rate}×` }))}
          value={playback.playbackRate}
          onChange={playback.changeRate}
          segmentClassName="px-2 tabular-nums"
        />
      </div>
    </div>
  );
}
