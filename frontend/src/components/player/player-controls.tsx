"use client";

import { ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";

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
    <span className="font-mono text-xs tabular-nums text-foreground" ref={output}>
      00:00.000
    </span>
  );
}

const buttonClass =
  "rounded-md p-2 text-muted-foreground transition hover:bg-muted hover:text-foreground";

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
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <button
        type="button"
        onClick={playback.toggle}
        aria-label={playback.isPlaying ? "Pause" : "Play"}
        className="rounded-md bg-primary p-2 text-primary-foreground transition hover:opacity-90"
      >
        {playback.isPlaying ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
      </button>

      <button
        type="button"
        onClick={() => playback.stepFrames(-1)}
        title="Previous frame (,)"
        aria-label="Step back one frame"
        className={buttonClass}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => playback.stepFrames(1)}
        title="Next frame (.)"
        aria-label="Step forward one frame"
        className={buttonClass}
      >
        <ChevronRight className="h-4 w-4" />
      </button>

      {/* The <video> is rendered without native controls, so this is the only
          way to reach volume at all — and a muted player has to be obvious,
          not a subtly different icon. */}
      {hasAudioTrack === false ? (
        <span
          title="FFmpeg found no audio stream in this file"
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground"
        >
          <VolumeX className="h-4 w-4" />
          No audio track
        </span>
      ) : (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={playback.toggleMute}
            aria-label={playback.isMuted ? "Unmute" : "Mute"}
            aria-pressed={playback.isMuted}
            className={cn(
              buttonClass,
              silent &&
                "bg-destructive/15 text-destructive hover:bg-destructive/25 hover:text-destructive"
            )}
          >
            {silent ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={playback.isMuted ? 0 : playback.volume}
            onChange={(event) => playback.changeVolume(Number(event.target.value))}
            aria-label="Volume"
            className="w-16 accent-primary"
          />
          {silent && <span className="text-xs font-medium text-destructive">Muted</span>}
        </div>
      )}

      <div className="ml-1 flex items-baseline gap-1">
        <PlaybackClock playback={playback} />
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          / {formatTimecode(playback.durationMs)}
        </span>
      </div>

      {/* The source's real pixel size. Shown because "the video looks worse
          than my original" is otherwise unanswerable — nothing here re-encodes
          video, so this is exactly what was uploaded. */}
      {playback.intrinsic && (
        <span
          title="Source resolution — the file is served exactly as uploaded"
          className="font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {playback.intrinsic.width}&times;{playback.intrinsic.height}
        </span>
      )}

      <div className="ml-auto flex items-center gap-1">
        {PLAYBACK_RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            onClick={() => playback.changeRate(rate)}
            aria-pressed={playback.playbackRate === rate}
            className={cn(
              "rounded px-1.5 py-1 font-mono text-[11px] tabular-nums transition",
              playback.playbackRate === rate
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {rate}&times;
          </button>
        ))}
      </div>
    </div>
  );
}
