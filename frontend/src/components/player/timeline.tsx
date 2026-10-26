"use client";

import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Playback } from "@/hooks/use-playback";
import { formatTimecode } from "@/lib/format";
import { HINT_CLASS, useOnceHint } from "@/lib/hints";
import { cn } from "@/lib/utils";
import type { Caption } from "@/types/caption";

const TRACK_HEIGHT = 76;
const RULER_HEIGHT = 18;

/** Zoom bounds. Two seconds across the width is enough to place a syllable. */
const MIN_WINDOW_MS = 2000;
const MAX_WINDOW_MS = 600_000;
const DEFAULT_WINDOW_MS = 12_000;
const ZOOM_FACTOR = 1.6;

/** Dragging must never invert a caption or shrink it to nothing. */
const MIN_DURATION_MS = 100;

/**
 * Neutral grey, not a theme colour.
 *
 * Canvas takes literal colours, so a CSS variable would have to be resolved at
 * draw time — and then go stale the moment the user flipped between light and
 * dark, because nothing re-runs the draw. A mid grey reads correctly on both.
 */
const WAVE_COLOR = "rgba(142, 142, 147, 0.5)";
const RULER_COLOR = "rgba(142, 142, 147, 0.35)";
const RULER_TEXT = "rgba(142, 142, 147, 1)";

/** Candidate gaps between ruler ticks, in milliseconds. */
const TICK_STEPS = [
  100, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000,
];

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));

interface DragState {
  captionId: number;
  edge: "start" | "end";
  startMs: number;
  endMs: number;
  /** Bounds imposed by the neighbouring captions, resolved once at grab time. */
  floorMs: number;
  ceilingMs: number;
}

interface TimelineProps {
  captions: Caption[];
  playback: Playback;
  peaks: number[];
  isLoadingWaveform: boolean;
  activeCaptionId: number | null;
  onCommit: (id: number, timing: { start_ms?: number; end_ms?: number }) => void;
}

export function Timeline({
  captions,
  playback,
  peaks,
  isLoadingWaveform,
  activeCaptionId,
  onCommit,
}: TimelineProps) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playhead = useRef<HTMLDivElement>(null);

  const [width, setWidth] = useState(0);
  const [windowStartMs, setWindowStartMs] = useState(0);
  const [windowMs, setWindowMs] = useState(DEFAULT_WINDOW_MS);
  const [drag, setDrag] = useState<DragState | null>(null);

  const durationMs = playback.durationMs;

  // The window tracks the playhead, so it is in view at every zoom: paged
  // ahead during playback, and brought back whenever a seek lands outside it
  // (v1.1.0, which dropped the scroll slider). Never while a boundary is
  // being dragged.
  const following = useRef(false);
  following.current = drag === null;
  const playing = useRef(false);
  playing.current = playback.isPlaying;
  const edgeHint = useOnceHint("timeline-edge");
  const [hintX, setHintX] = useState(0);

  const msToX = useCallback(
    (ms: number) => ((ms - windowStartMs) / windowMs) * width,
    [windowStartMs, windowMs, width]
  );

  const maxStart = Math.max(0, durationMs - windowMs);

  // useLayoutEffect, not useEffect: the first paint needs a real width or the
  // canvas draws into a zero-pixel surface and flashes empty.
  useLayoutEffect(() => {
    const node = container.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);

    return () => observer.disconnect();
  }, []);

  // A short video should show all of itself rather than a window wider than
  // the footage. Only ever narrows, so it can't fight the zoom buttons.
  useEffect(() => {
    if (durationMs > 0) setWindowMs((current) => Math.min(current, durationMs));
  }, [durationMs]);

  /**
   * Move the playhead by writing a transform directly.
   *
   * This is the payoff from the subscription in use-playback: at sixty frames
   * a second, React state here would re-render every caption block on the
   * timeline for a two-pixel move.
   */
  useEffect(
    () =>
      playback.subscribe((ms) => {
        const marker = playhead.current;
        if (!marker) return;

        const x = msToX(ms);
        const visible = x >= 0 && x <= width;
        marker.style.transform = `translateX(${x}px)`;
        marker.style.opacity = visible ? "1" : "0";

        // Page the window forward once the playhead nears the right edge,
        // rather than scrolling continuously — a timeline sliding under a
        // stationary playhead is much harder to read than a still one. When
        // paused, only once it reaches the last 3% of the view, so a click
        // near the edge doesn't move the track under the pointer.
        if (following.current && (ms < windowStartMs || x > width * (playing.current ? 0.9 : 0.97))) {
          setWindowStartMs(clamp(ms - windowMs * 0.1, 0, Math.max(0, durationMs - windowMs)));
        }
      }),
    [playback, msToX, width, windowStartMs, windowMs, durationMs]
  );

  // Draw the waveform and ruler for the visible window.
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || width <= 0) return;

    const context = surface.getContext("2d");
    if (!context) return;

    // Back the canvas with real device pixels; on a HiDPI screen the default
    // would be upscaled and blurry.
    const ratio = window.devicePixelRatio || 1;
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(TRACK_HEIGHT * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, TRACK_HEIGHT);

    // ── Ruler ─────────────────────────────────────────
    // Pick the finest tick spacing that still leaves labels legible.
    const step =
      TICK_STEPS.find((candidate) => (candidate / windowMs) * width >= 64) ??
      TICK_STEPS[TICK_STEPS.length - 1];

    context.fillStyle = RULER_COLOR;
    context.font = "10px ui-monospace, monospace";

    for (
      let tick = Math.ceil(windowStartMs / step) * step;
      tick <= windowStartMs + windowMs;
      tick += step
    ) {
      const x = Math.round(msToX(tick)) + 0.5; // half-pixel: a crisp 1px line
      context.fillRect(x, 0, 1, RULER_HEIGHT - 6);
      context.fillStyle = RULER_TEXT;
      context.fillText(formatTimecode(tick).replace(/\.\d+$/, ""), x + 3, RULER_HEIGHT - 7);
      context.fillStyle = RULER_COLOR;
    }

    // ── Waveform ──────────────────────────────────────
    if (!peaks.length || durationMs <= 0) return;

    const waveTop = RULER_HEIGHT;
    const waveHeight = TRACK_HEIGHT - RULER_HEIGHT;
    const middle = waveTop + waveHeight / 2;

    context.fillStyle = WAVE_COLOR;

    for (let x = 0; x < width; x++) {
      // Each pixel covers a span of peaks when zoomed out. Taking the loudest
      // in that span, rather than sampling one, is what stops the waveform
      // shimmering as the window scrolls past.
      const fromMs = windowStartMs + (x / width) * windowMs;
      const toMs = windowStartMs + ((x + 1) / width) * windowMs;

      const first = Math.floor((fromMs / durationMs) * peaks.length);
      const last = Math.max(first, Math.ceil((toMs / durationMs) * peaks.length) - 1);
      if (last < 0 || first >= peaks.length) continue;

      let loudest = 0;
      for (let i = Math.max(0, first); i <= Math.min(last, peaks.length - 1); i++) {
        if (peaks[i] > loudest) loudest = peaks[i];
      }

      const height = Math.max(1, loudest * (waveHeight - 8));
      context.fillRect(x, middle - height / 2, 1, height);
    }
  }, [peaks, width, windowStartMs, windowMs, durationMs, msToX]);

  function zoom(direction: 1 | -1) {
    const anchor = playback.currentMs();
    const next = clamp(
      direction > 0 ? windowMs / ZOOM_FACTOR : windowMs * ZOOM_FACTOR,
      MIN_WINDOW_MS,
      Math.min(MAX_WINDOW_MS, Math.max(MIN_WINDOW_MS, durationMs || MAX_WINDOW_MS))
    );

    setWindowMs(next);
    // Keep whatever you were looking at under the cursor instead of jumping to
    // a different part of the video.
    setWindowStartMs(clamp(anchor - next * 0.3, 0, Math.max(0, durationMs - next)));
  }

  function xToMs(clientX: number, rect: DOMRect) {
    return clamp(
      windowStartMs + ((clientX - rect.left) / rect.width) * windowMs,
      0,
      durationMs || Number.MAX_SAFE_INTEGER
    );
  }

  function handleTrackPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    playback.seekMs(xToMs(event.clientX, rect));
  }

  function beginDrag(
    event: React.PointerEvent<HTMLDivElement>,
    caption: Caption,
    index: number,
    edge: "start" | "end"
  ) {
    // Otherwise the click also reaches the track behind and seeks the video.
    event.stopPropagation();
    event.preventDefault();
    // Pointer capture routes every subsequent move to this handle, so the drag
    // survives the cursor leaving the eight-pixel target — which it will.
    event.currentTarget.setPointerCapture(event.pointerId);

    setDrag({
      captionId: caption.id,
      edge,
      startMs: caption.start_ms,
      endMs: caption.end_ms,
      floorMs: captions[index - 1]?.end_ms ?? 0,
      ceilingMs:
        captions[index + 1]?.start_ms ?? (durationMs || caption.end_ms + windowMs),
    });
  }

  function handleDragMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag || !container.current) return;

    const rect = container.current.getBoundingClientRect();
    const at = xToMs(event.clientX, rect);

    setDrag(
      drag.edge === "start"
        ? { ...drag, startMs: clamp(at, drag.floorMs, drag.endMs - MIN_DURATION_MS) }
        : { ...drag, endMs: clamp(at, drag.startMs + MIN_DURATION_MS, drag.ceilingMs) }
    );
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    event.currentTarget.releasePointerCapture(event.pointerId);

    const original = captions.find((caption) => caption.id === drag.captionId);
    const rounded =
      drag.edge === "start" ? Math.round(drag.startMs) : Math.round(drag.endMs);

    // One PATCH on release, not one per pointermove. The intermediate values
    // were never anything the user meant to save.
    if (original && rounded !== (drag.edge === "start" ? original.start_ms : original.end_ms)) {
      onCommit(
        drag.captionId,
        drag.edge === "start" ? { start_ms: rounded } : { end_ms: rounded }
      );
    }

    setDrag(null);
  }

  const windowEndMs = windowStartMs + windowMs;
  const visible = captions.filter(
    (caption) => caption.end_ms >= windowStartMs && caption.start_ms <= windowEndMs
  );

  return (
    <section>
      <header className="mb-1.5 flex items-center justify-between">
        <h2 className="label-caps">Timeline</h2>
        <div className="flex items-center gap-1">
          {isLoadingWaveform && (
            <span className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Reading audio…
            </span>
          )}
          {drag ? (
            <span className="mr-1 font-mono text-xs tabular-nums text-primary">
              {formatTimecode(drag.startMs)} → {formatTimecode(drag.endMs)}
            </span>
          ) : (
            <span className="mr-1 text-xs tabular-nums text-muted-foreground">
              {(windowMs / 1000).toFixed(1)} s across
            </span>
          )}
          <button
            type="button"
            onClick={() => zoom(-1)}
            aria-label="Zoom out"
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-foreground sm:size-8"
          >
            <ZoomOut className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => zoom(1)}
            aria-label="Zoom in"
            className="flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-200 ease-out hover:bg-surface-2 hover:text-foreground sm:size-8"
          >
            <ZoomIn className="size-4" />
          </button>
        </div>
      </header>

      <div
        ref={container}
        onPointerDown={handleTrackPointerDown}
        // A horizontal swipe, or Shift and the wheel, pans the window.
        onWheel={(event) => {
          const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.shiftKey ? event.deltaY : 0;
          if (!delta || width <= 0) return;
          setWindowStartMs((start) => clamp(start + (delta / width) * windowMs, 0, maxStart));
        }}
        style={{ height: TRACK_HEIGHT }}
        className="relative w-full cursor-pointer select-none overflow-hidden rounded-lg bg-surface-2"
      >
        <canvas
          ref={canvas}
          style={{ width, height: TRACK_HEIGHT }}
          className="pointer-events-none absolute left-0 top-0"
        />

        {visible.map((caption) => {
          const dragging = drag?.captionId === caption.id;
          const startMs = dragging ? drag.startMs : caption.start_ms;
          const endMs = dragging ? drag.endMs : caption.end_ms;
          const left = msToX(startMs);
          const index = captions.indexOf(caption);

          return (
            <div
              key={caption.id}
              onPointerDown={(event) => {
                event.stopPropagation();
                playback.seekMs(caption.start_ms);
              }}
              style={{
                left,
                width: Math.max(2, msToX(endMs) - left),
                top: RULER_HEIGHT + 6,
                height: TRACK_HEIGHT - RULER_HEIGHT - 12,
              }}
              className={cn(
                // Neutral blocks; the one under the playhead takes the
                // accent (the selected state).
                "absolute overflow-hidden rounded-md text-[11px] leading-tight transition-colors duration-150 ease-out",
                caption.id === activeCaptionId || dragging
                  ? "bg-primary/20 ring-1 ring-inset ring-accent"
                  : "bg-surface-3 hover:bg-surface-3/70"
              )}
              title={caption.text}
            >
              <span className="pointer-events-none block truncate px-2 py-1 text-foreground">
                {caption.text}
              </span>

              {(["start", "end"] as const).map((edge) => (
                <div
                  key={edge}
                  onPointerEnter={(event) => {
                    const track = container.current?.getBoundingClientRect();
                    if (track) setHintX(event.currentTarget.getBoundingClientRect().left - track.left);
                    edgeHint.show();
                  }}
                  onPointerLeave={edgeHint.done}
                  onPointerDown={(event) => beginDrag(event, caption, index, edge)}
                  onPointerMove={handleDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  role="separator"
                  aria-label={`Drag the ${edge} of this caption`}
                  className={cn(
                    "absolute inset-y-0 w-2 cursor-ew-resize bg-transparent transition-colors duration-150 ease-out hover:bg-accent",
                    edge === "start" ? "left-0" : "right-0"
                  )}
                />
              ))}
            </div>
          );
        })}

        {/* The playhead (v1.1.0): a 2 px accent line with a small head,
            drawn over the blocks; the window follows it, so it is in view at
            every zoom. */}
        <div
          ref={playhead}
          className="pointer-events-none absolute top-0 z-10 h-full w-0.5 -translate-x-px bg-accent"
          style={{ willChange: "transform" }}
        >
          <div className="absolute -left-[4px] -top-px h-2.5 w-2.5 rounded-b-full rounded-t-sm bg-accent" />
        </div>
      </div>

      {/* Shown once, the first time a caption's edge is hovered. */}
      <div className="relative h-0">
        {edgeHint.showing && (
          <span className={HINT_CLASS} style={{ left: Math.max(0, hintX - 60), top: 6 }}>
            Drag an edge to retime the caption · click the track to seek
          </span>
        )}
      </div>
    </section>
  );
}
