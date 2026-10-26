"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useInjectedFontFace } from "@/hooks/use-fonts";
import {
  MAX_BOX_WIDTH,
  MIN_BOX_WIDTH,
  SAFE_AREA,
  boxWidthOf,
  clearMeasurements,
  fontsFor,
  ink,
  layoutCaption,
  type Frame,
  type Layout,
} from "@/lib/caption-layout";
import { captionLineStyle, captionPaintStyle } from "@/lib/caption-style";
import { HINT_CLASS, useOnceHint } from "@/lib/hints";
import { cn } from "@/lib/utils";
import type { Caption } from "@/types/caption";
import type { CaptionStyle, Font } from "@/types/style";

/**
 * The nine built-ins already have an `@font-face` in globals.css, or are system
 * faces needing none. Everything else is a catalogue family whose rule has to
 * be added at runtime — there are 1301 of them and a stylesheet declaring all
 * of them would be megabytes of rules for faces nobody will pick.
 */
const BUILT_IN = new Set([
  "sans", "serif", "mono", "dejavu",
  "poppins", "lato", "barlow-condensed", "anton", "bebas-neue",
]);

/** Far enough to mean "move this" rather than "I clicked". */
const DRAG_THRESHOLD = 4;

/** Arrow-key steps, as fractions of the frame. */
const KEY_STEP = 0.01;
const KEY_STEP_LARGE = 0.1;
const WIDTH_STEP = 0.01;
const WIDTH_STEP_LARGE = 0.05;

/** How close the centre has to come to the frame's middle to snap to it, in CSS px. */
const SNAP_PX = 8;

/** The handles' hit area, in CSS pixels. WCAG 2.5.8 asks for 24. */
const HANDLE_SIZE = 28;
const EDGE_HANDLE_WIDTH = 24;

export type Placement = Partial<Pick<CaptionStyle, "pos_x" | "pos_y" | "box_width">>;

interface CaptionOverlayProps {
  caption: Caption | null;
  style: CaptionStyle | undefined;
  font: Font | undefined;
  /** The video's own size, which the layout works in. Unknown until metadata. */
  frameSize?: Frame | null;
  /** Move or resize the caption box. Omitted where the overlay is read-only. */
  onPlace?: (placement: Placement) => void;
  /** Play/pause, for a press that turned out to be a click rather than a drag. */
  onToggle?: () => void;
}

/** What a gesture in flight is doing, captured when the pointer goes down. */
interface Grab {
  kind: "move" | "width";
  pointerX: number;
  pointerY: number;
  /** Where the box's centre was drawn when it was grabbed, as fractions. */
  startX: number;
  startY: number;
  frame: DOMRect;
}

/** A gesture's live result, drawn without saving until it ends. */
interface Live {
  center?: { x: number; y: number };
  boxWidth?: number;
  snapX?: boolean;
  snapY?: boolean;
}

const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * The styled caption drawn over the video, laid out by the same rule as the
 * burn (lib/caption-layout.ts) in the video's own pixels and drawn scaled to
 * the player, so what's on screen is what the MP4 gets.
 *
 * The box is placed by its centre and keeps its width wherever it is
 * dragged: the layout slides it inside the safe area instead of letting an
 * edge shrink or rewrap it. Three handles: the grip on its top edge (drag, or
 * arrow keys) and the left and right edges of its wrap box (drag, or arrow
 * keys) for the width, which the Max width slider also sets.
 */
export function CaptionOverlay({
  caption,
  style,
  font,
  frameSize,
  onPlace,
  onToggle,
}: CaptionOverlayProps) {
  const frame = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [live, setLive] = useState<Live | null>(null);
  const [dragging, setDragging] = useState<Grab["kind"] | null>(null);
  // The pointer is over or close to the caption (v1.1.0): the handles show
  // then, while one has focus, or while dragging; never permanently.
  const [near, setNear] = useState(false);
  const hint = useOnceHint("caption-drag");
  /** Bumped when a face finishes loading, so the layout measures it again. */
  const [, setFontsVersion] = useState(0);

  const grab = useRef<Grab | null>(null);
  const latest = useRef<{ x: number; y: number } | null>(null);
  const painting = useRef<number | null>(null);
  const pending = useRef<Live | null>(null);
  const moved = useRef(false);
  /**
   * Where the arrow keys last put the caption. The next press builds on this
   * rather than on the cache, which follows a render later, so a quick
   * second press doesn't measure the old position and lose the first.
   */
  const keyed = useRef<{ x: number; y: number } | null>(null);
  const keyedWidth = useRef<number | null>(null);

  const libraryKey = style && !BUILT_IN.has(style.font_key) ? style.font_key : undefined;
  useInjectedFontFace(libraryKey, style?.font_family);

  // useLayoutEffect: measure before paint, or the first caption renders at a
  // scale of zero and visibly jumps.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const box = entry.borderBoxSize?.[0];
      const rect = entry.target.getBoundingClientRect();
      setSize({ width: box?.inlineSize ?? rect.width, height: box?.blockSize ?? rect.height });
    });
    observer.observe(node);
    const rect = node.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    return () => observer.disconnect();
  }, []);

  // Widths measured before a face loaded are the fallback's. Load the faces
  // this caption needs, then measure again.
  const text = caption?.text ?? "";
  const fontKey = style ? fontsFor(style).join("|") : "";
  useEffect(() => {
    if (!style || typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    Promise.all(fontsFor(style).map((f) => document.fonts.load(f, text || "A").catch(() => [])))
      .then((loaded) => {
        if (cancelled || !loaded.some((faces) => faces.length)) return;
        clearMeasurements();
        setFontsVersion((v) => v + 1);
      });
    return () => {
      cancelled = true;
    };
    // `style` is read through fontKey: the faces, not every field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontKey, text]);

  const stored = style ? `${style.pos_x},${style.pos_y},${style.box_width}` : "";

  // The layout works in the video's pixels; until the metadata says what they
  // are, the player's own size has the right shape.
  const video: Frame =
    frameSize && frameSize.width > 0 && frameSize.height > 0 ? frameSize : size;
  const scale = video.height > 0 ? size.height / video.height : 0;
  const ready = Boolean(style && size.height > 0 && scale > 0);

  const layoutFor = (options: Live | null): Layout | null =>
    ready && style
      ? layoutCaption(caption?.text ?? "", style, video, {
          overrideScale: caption?.override_scale,
          bold: caption?.override_bold,
          center: options?.center,
          boxWidth: options?.boxWidth,
        })
      : null;
  const layout = layoutFor(live);

  // Keep the grip inside the frame: it sits on the box's top edge, and a box
  // against the top of the safe area would leave half of it clipped.
  const gripTop = layout ? Math.max(HANDLE_SIZE / 2, layout.y * scale) : 0;
  const gripX = layout
    ? style?.alignment === "left"
      ? layout.x * scale
      : style?.alignment === "right"
        ? (layout.x + layout.width) * scale
        : layout.centerX * scale
    : 0;

  function frameRect(): DOMRect | null {
    const rect = frame.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0 ? rect : null;
  }

  /** The centre and width being drawn now, as fractions. */
  function current(): { x: number; y: number; width: number } {
    const l = layout;
    if (!l || !style) return { x: 0.5, y: 0.5, width: 0.8 };
    return { x: l.centerX / video.width, y: l.centerY / video.height, width: l.boxWidth / video.width };
  }

  /**
   * Draw the gesture at frame rate. Only this overlay re-renders: the style
   * in the cache (and so the player, the panel and the caption list) is
   * written once, when the gesture ends.
   */
  function paint() {
    painting.current = null;
    const g = grab.current;
    const pointer = latest.current;
    if (!g || !pointer || !style) return;
    if (g.kind === "move") {
      let x = g.startX + (pointer.x - g.pointerX) / g.frame.width;
      let y = g.startY + (pointer.y - g.pointerY) / g.frame.height;
      // Snap to the frame's centre lines.
      const snapX = Math.abs(x - 0.5) * g.frame.width < SNAP_PX;
      const snapY = Math.abs(y - 0.5) * g.frame.height < SNAP_PX;
      if (snapX) x = 0.5;
      if (snapY) y = 0.5;
      pending.current = { center: { x, y }, snapX, snapY };
    } else {
      const centre = g.frame.left + g.startX * g.frame.width;
      const width = clamp((2 * Math.abs(pointer.x - centre)) / g.frame.width, MIN_BOX_WIDTH, MAX_BOX_WIDTH);
      pending.current = { boxWidth: width };
    }
    setLive(pending.current);
  }

  function start(kind: Grab["kind"], event: React.PointerEvent) {
    keyed.current = null;
    keyedWidth.current = null;
    const rect = frameRect();
    if (!rect || !style || !onPlace) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const now = current();
    grab.current = { kind, pointerX: event.clientX, pointerY: event.clientY, startX: now.x, startY: now.y, frame: rect };
    pending.current = null;
    moved.current = false;
  }

  function handleMove(event: React.PointerEvent) {
    const g = grab.current;
    if (!g) return;
    if (!moved.current) {
      const far =
        Math.abs(event.clientX - g.pointerX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - g.pointerY) > DRAG_THRESHOLD;
      if (!far) return;
      moved.current = true;
      setDragging(g.kind);
    }
    latest.current = { x: event.clientX, y: event.clientY };
    if (painting.current === null) painting.current = requestAnimationFrame(paint);
  }

  /** The finished gesture as a patch: the centre the box is drawn at, or the width. */
  function commit(result: Live | null) {
    if (!result || !onPlace) return;
    if (result.boxWidth !== undefined) {
      onPlace({ box_width: round3(result.boxWidth) });
      return;
    }
    if (result.center) {
      // Where the pointer asked for, kept inside the frame: every caption is
      // slid inside the safe area by its own size, so one dragged against an
      // edge saves "against that edge" and a shorter caption sits there too.
      onPlace({
        pos_x: round3(clamp(result.center.x, 0, 1)),
        pos_y: round3(clamp(result.center.y, 0, 1)),
      });
    }
  }

  /** Release or cancel: stop drawing, and save the result if it was a drag. */
  function end(event: React.PointerEvent) {
    const g = grab.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (painting.current !== null) {
      cancelAnimationFrame(painting.current);
      painting.current = null;
      if (latest.current && g) paint();
    }
    const dragged = moved.current;
    const result = pending.current;
    moved.current = false;
    grab.current = null;
    latest.current = null;
    setDragging(null);
    if (dragged) commit(result);
    // The cache catches up a render later; until it has, the drawn result is
    // held, or the box would flick back to where the gesture started.
    if (!dragged) setLive(null);
  }

  // Let go of the held result once the style has caught up — or moved for
  // another reason (a preset, a reset, the slider), and the arrow keys'
  // running position with it.
  useEffect(() => {
    if (grab.current) return;
    setLive(null);
  }, [stored]);
  useEffect(() => {
    keyed.current = null;
    keyedWidth.current = null;
    // Only when the style changed underneath the keys, not when they changed it.
  }, [style?.alignment, style?.max_lines, style?.font_size]);

  function handleSurfaceDown(event: React.PointerEvent) {
    keyed.current = null;
    start("move", event);
  }

  function handleSurfaceUp(event: React.PointerEvent) {
    // A press that never moved is a click, and on a video a click means play.
    // On a handle it isn't: it focuses the handle, ready for the arrow keys.
    const clicked = !moved.current && grab.current !== null;
    end(event);
    if (clicked) onToggle?.();
  }

  /** Arrow keys on the grip move the box's centre; Shift moves it ten times as far. */
  function handleMoveKey(event: React.KeyboardEvent) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta || !style || !onPlace || !ready) return;
    event.preventDefault();
    const from = keyed.current ?? current();
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const asked = { x: from.x + delta[0] * step, y: from.y + delta[1] * step };
    // Built on where the box is *drawn*, so a press against an edge doesn't
    // walk the saved centre off into a dead zone the next press must undo.
    const drawn = layoutFor({ center: asked });
    if (!drawn) return;
    const next = { x: clamp(drawn.centerX / video.width, 0, 1), y: clamp(drawn.centerY / video.height, 0, 1) };
    keyed.current = next;
    setLive({ center: next });
    onPlace({ pos_x: round3(next.x), pos_y: round3(next.y) });
  }

  /** Arrow keys on an edge handle: outward widens, inward narrows. */
  function handleWidthKey(side: "left" | "right", event: React.KeyboardEvent) {
    const outward = side === "left" ? "ArrowLeft" : "ArrowRight";
    const inward = side === "left" ? "ArrowRight" : "ArrowLeft";
    const sign =
      event.key === outward || event.key === "ArrowUp" ? 1 : event.key === inward || event.key === "ArrowDown" ? -1 : 0;
    if (!sign || !style || !onPlace || !ready) return;
    event.preventDefault();
    const from = keyedWidth.current ?? current().width;
    const next = clamp(from + sign * (event.shiftKey ? WIDTH_STEP_LARGE : WIDTH_STEP), MIN_BOX_WIDTH, MAX_BOX_WIDTH);
    keyedWidth.current = next;
    setLive({ boxWidth: next });
    onPlace({ box_width: round3(next) });
  }

  const draggable = Boolean(onPlace && style);
  const painted = layout && caption ? ink(layout) : null;
  // Which safe-area edges the box is pressed against, for the guides.
  const against = painted
    ? {
        left: painted.x <= SAFE_AREA * video.width + 0.5,
        right: painted.x + painted.width >= (1 - SAFE_AREA) * video.width - 0.5,
        top: painted.y <= SAFE_AREA * video.height + 0.5,
        bottom: painted.y + painted.height >= (1 - SAFE_AREA) * video.height - 0.5,
      }
    : null;
  const widthPercent = style ? Math.round((live?.boxWidth ?? boxWidthOf(style, video)) * 100) : 0;

  /** Whether a pointer at this client position is on or close to the caption box. */
  function trackNear(event: React.PointerEvent) {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || !layout) return;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const left = layout.boxLeft * scale;
    const top = layout.y * scale;
    const close =
      x >= left - 20 && x <= left + layout.boxWidth * scale + 20 && y >= top - 32 && y <= top + layout.height * scale + 20;
    setNear(close);
    if (close) hint.show();
    else hint.done();
  }

  function leave() {
    setNear(false);
    hint.done();
  }

  const handlesShown = near || dragging !== null;

  return (
    <div ref={frame} className="group/cap pointer-events-none absolute inset-0">
      {/*
        The whole frame is a drag surface for the box, not just the caption:
        aiming at one line of type is hard, and in a gap between captions there
        is nothing to aim at. The box moves by the distance the pointer moves,
        from wherever it already was, so grabbing it never makes it jump.
      */}
      {draggable && (
        <div
          className={dragging === "move" ? "absolute inset-0 cursor-grabbing" : "absolute inset-0 cursor-grab"}
          style={{ pointerEvents: "auto", touchAction: "none" }}
          onPointerDown={handleSurfaceDown}
          onPointerMove={(event) => {
            trackNear(event);
            handleMove(event);
          }}
          onPointerLeave={leave}
          onPointerUp={handleSurfaceUp}
          onPointerCancel={(event) => end(event)}
        />
      )}

      {/* Guides while dragging: the frame's centre lines when the box snaps to
          them, and the safe area's edge when the box is pressed against it. */}
      {dragging && (
        <div aria-hidden="true" data-caption-guides className="pointer-events-none absolute inset-0">
          {live?.snapX && <span data-guide="center-x" className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary" />}
          {live?.snapY && <span data-guide="center-y" className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-primary" />}
          {against?.left && <span data-guide="safe-left" className="absolute inset-y-0 w-px bg-white/60" style={{ left: `${SAFE_AREA * 100}%` }} />}
          {against?.right && <span data-guide="safe-right" className="absolute inset-y-0 w-px bg-white/60" style={{ right: `${SAFE_AREA * 100}%` }} />}
          {against?.top && <span data-guide="safe-top" className="absolute inset-x-0 h-px bg-white/60" style={{ top: `${SAFE_AREA * 100}%` }} />}
          {against?.bottom && <span data-guide="safe-bottom" className="absolute inset-x-0 h-px bg-white/60" style={{ bottom: `${SAFE_AREA * 100}%` }} />}
        </div>
      )}

      {/* Where this gesture has got to: the centre, or the width. */}
      {dragging && layout && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/75 px-2 py-1 text-xs tabular-nums text-white"
        >
          {dragging === "width"
            ? `width ${widthPercent}%`
            : `${Math.round((layout.centerX / video.width) * 100)}% · ${Math.round((layout.centerY / video.height) * 100)}%`}
        </div>
      )}

      {layout && caption && style && (
        <div
          data-caption-box
          data-caption-text
          className="pointer-events-none"
          style={captionPaintStyle(style, font, layout, scale, caption)}
        >
          {/* A space between lines, which collapses away between two blocks,
              so the caption's text reads as a sentence to a screen reader. */}
          {layout.lines.map((line, i) => (
            <Fragment key={i}>
              {i > 0 && " "}
              <span data-caption-line style={captionLineStyle(line.pitch, scale)}>
                {line.segments.map((s) => s.text).join("")}
              </span>
            </Fragment>
          ))}
        </div>
      )}

      {/* Shown once, the first time the caption is hovered. */}
      {hint.showing && layout && !dragging && (
        <span
          className={HINT_CLASS}
          style={{ left: Math.max(4, layout.boxLeft * scale), top: Math.max(4, layout.y * scale - 40) }}
        >
          Drag to place the caption · drag its edges to change the width · click the video to play or pause
        </span>
      )}

      {/* The wrap box and its width handles: dashed while it's being changed. */}
      {draggable && layout && caption && (
        <>
          <div
            aria-hidden="true"
            data-caption-wrap-box
            className={cn(
              "pointer-events-none absolute rounded-sm border border-dashed",
              dragging === "width" ? "border-white/80" : "border-white/0"
            )}
            style={{
              left: layout.boxLeft * scale,
              top: layout.y * scale,
              width: layout.boxWidth * scale,
              height: layout.height * scale,
            }}
          />
          {(["left", "right"] as const).map((side) => (
            <button
              key={side}
              type="button"
              role="slider"
              aria-label={`Caption width, ${side} edge`}
              aria-orientation="horizontal"
              aria-valuemin={MIN_BOX_WIDTH * 100}
              aria-valuemax={MAX_BOX_WIDTH * 100}
              aria-valuenow={widthPercent}
              aria-valuetext={`${widthPercent}% of the frame`}
              title="Drag to change the caption's width · arrow keys too"
              data-width-handle={side}
              style={{
                left: (side === "left" ? layout.boxLeft : layout.boxLeft + layout.boxWidth) * scale,
                top: (layout.y + layout.height / 2) * scale,
                width: EDGE_HANDLE_WIDTH,
                height: Math.max(HANDLE_SIZE, Math.min(48, layout.height * scale)),
                pointerEvents: "auto",
                touchAction: "none",
              }}
              className={cn(
                "group absolute z-10 flex -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center",
                "transition-opacity duration-200 ease-out group-focus-within/cap:opacity-100",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-white",
                handlesShown ? "opacity-100" : "opacity-0"
              )}
              onPointerEnter={() => setNear(true)}
              onPointerDown={(event) => start("width", event)}
              onPointerMove={handleMove}
              onPointerUp={(event) => end(event)}
              onPointerCancel={(event) => end(event)}
              onKeyDown={(event) => handleWidthKey(side, event)}
              onBlur={() => {
                keyedWidth.current = null;
              }}
            >
              {/* 3 px to see, the button around it wide enough to grab. */}
              <span className="h-full w-[3px] rounded-full bg-white ring-1 ring-black/30" />
            </button>
          ))}
        </>
      )}

      {draggable && layout && (
        <button
          ref={handle}
          type="button"
          aria-label="Move caption"
          title="Drag to move the caption · arrow keys to nudge it (Shift for bigger steps)"
          style={{
            left: gripX,
            top: gripTop,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            pointerEvents: "auto",
            touchAction: "none",
          }}
          className={cn(
            "absolute z-20 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
            "transition-opacity duration-200 ease-out group-focus-within/cap:opacity-100",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
            handlesShown ? "opacity-100" : "opacity-0",
            dragging === "move" ? "cursor-grabbing" : "cursor-grab"
          )}
          onPointerEnter={() => setNear(true)}
          onPointerDown={(event) => start("move", event)}
          onPointerMove={handleMove}
          onPointerUp={(event) => end(event)}
          onPointerCancel={(event) => end(event)}
          onKeyDown={handleMoveKey}
          onBlur={() => {
            keyed.current = null;
          }}
        >
          {/* A small white dot to see; the button is the 28 px to grab. */}
          <span aria-hidden="true" className="size-3 rounded-full bg-white ring-1 ring-black/30" />
        </button>
      )}
    </div>
  );
}
