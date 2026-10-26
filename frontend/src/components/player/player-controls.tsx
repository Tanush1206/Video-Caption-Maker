"use client";

import { Check, ChevronLeft, ChevronRight, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef } from "react";

import { Popover } from "@/components/ui/popover";
import { Range } from "@/components/ui/range";
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
    // One quiet row (v1.1.0): the time on the left, the transport in the
    // centre, sound and speed behind two buttons on the right. Three explicit
    // columns, so the transport stays optically centred whatever the time's
    // width. On a phone the frame steps go, and the row still fits one line.
    <div className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
      <div className="flex min-w-0 items-baseline gap-1.5 whitespace-nowrap">
        <PlaybackClock playback={playback} />
        <span className="font-mono text-sm tabular-nums text-muted-foreground">
          / {formatTimecode(playback.durationMs)}
        </span>
      </div>

      <div className="flex items-center justify-center gap-1">
        <button
          type="button"
          onClick={() => playback.stepFrames(-1)}
          title="Previous frame (,)"
          aria-label="Step back one frame"
          className={cn(buttonClass, "max-sm:hidden")}
        >
          <ChevronLeft className="size-5" />
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
          className={cn(buttonClass, "max-sm:hidden")}
        >
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="flex items-center justify-end gap-0.5">
        {/* The <video> has no native controls, so this is the only way to
            reach the volume, and a muted player has to be obvious. */}
        {hasAudioTrack === false ? (
          <span
            title="FFmpeg found no audio stream in this file"
            aria-label="No audio in this file"
            className="flex size-11 items-center justify-center text-muted-foreground sm:size-9"
          >
            <VolumeX className="size-5" />
          </span>
        ) : (
          <Popover
            label={silent ? "Volume (muted)" : "Volume"}
            trigger={silent ? <VolumeX className="size-5 text-destructive" /> : <Volume2 className="size-5" />}
            panelClassName="flex w-52 items-center gap-2"
          >
            {() => (
              <>
                <button
                  type="button"
                  onClick={playback.toggleMute}
                  aria-label={playback.isMuted ? "Unmute" : "Mute"}
                  aria-pressed={playback.isMuted}
                  className={cn(buttonClass, "shrink-0", silent && "text-destructive")}
                >
                  {silent ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
                </button>
                <Range
                  min={0}
                  max={1}
                  step={0.05}
                  value={playback.isMuted ? 0 : playback.volume}
                  onChange={(event) => playback.changeVolume(Number(event.target.value))}
                  aria-label="Volume"
                />
              </>
            )}
          </Popover>
        )}

        {/* One setting with six values, behind the button that shows it. */}
        <Popover
          label={`Playback speed: ${playback.playbackRate}×`}
          trigger={<span className="text-sm font-medium tabular-nums">{playback.playbackRate}×</span>}
          panelClassName="w-32 p-1"
        >
          {(close) => (
            <div role="menu" aria-label="Playback speed">
              {PLAYBACK_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  role="menuitemradio"
                  aria-checked={playback.playbackRate === rate}
                  onClick={() => {
                    playback.changeRate(rate);
                    close();
                  }}
                  className="flex min-h-11 w-full items-center justify-between rounded-md px-3 text-[15px] tabular-nums transition-colors duration-150 ease-out hover:bg-surface-3 focus:bg-surface-3 focus-visible:ring-0 sm:min-h-8 sm:text-sm"
                >
                  {rate}×
                  {playback.playbackRate === rate && <Check className="size-4 text-primary" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}
