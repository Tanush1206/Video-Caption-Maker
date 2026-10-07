"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { useInjectedFontFace } from "@/hooks/use-fonts";
import {
  ANCHOR_SHIFT,
  anchorFromStyle,
  clampPlacement,
  type BoxFraction,
  type FreePlacement,
} from "@/lib/caption-drag";
import {
  applyFreePosition,
  captionBoxStyle,
  captionTextStyle,
  freePosition,
  scaleFor,
} from "@/lib/caption-style";
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

interface CaptionOverlayProps {
  caption: Caption | null;
  style: CaptionStyle | undefined;
  font: Font | undefined;
  /** Place the caption by hand. Omitted where the overlay is read-only. */
  onPlace?: (placement: FreePlacement) => void;
  /** Play/pause, for a press that turned out to be a click rather than a drag. */
  onToggle?: () => void;
}

/** Everything a drag needs to know, captured once when the pointer goes down. */
interface Grab {
  pointerX: number;
  pointerY: number;
  /** Where the caption's anchor was at the moment it was grabbed. */
  anchorX: number;
  anchorY: number;
  /** The frame, measured once — a drag cannot resize the player. */
  frame: DOMRect;
  size: BoxFraction;
}

/**
 * The styled caption drawn over the video.
 *
 * This is the thing Milestone 8 has to reproduce, so it measures its own
 * rendered height rather than using the video's pixel dimensions. The player is
 * usually smaller than the file it is playing, and a caption has to take up the
 * same fraction of the frame at either size — otherwise the preview looks right
 * on screen and comes out twice the size in the export.
 *
 * Two elements, not one. The outer div is the frame: full-bleed, unpadded, and
 * the thing that gets measured. The inner div is the caption, positioned inside
 * it. They used to be the same element, which is what let the caption's own
 * margins feed back into the scale computed from its height.
 */
export function CaptionOverlay({
  caption,
  style,
  font,
  onPlace,
  onToggle,
}: CaptionOverlayProps) {
  const frame = useRef<HTMLDivElement>(null);
  const boxEl = useRef<HTMLDivElement>(null);
  /** The text itself, which is what gets measured — see `textBox`. */
  const textEl = useRef<HTMLSpanElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [dragging, setDragging] = useState(false);

  /** Null between drags. Set on pointer-down, read on every move. */
  const grab = useRef<Grab | null>(null);
  /** The newest pointer position, waiting for a frame to be drawn on. */
  const latest = useRef<{ x: number; y: number } | null>(null);
  const painting = useRef<number | null>(null);
  /** Where the drag has got to. Committed to the server on release. */
  const live = useRef<FreePlacement | null>(null);
  /** Whether this press has travelled far enough to be a drag at all. */
  const moved = useRef(false);

  // Unconditionally called with possibly-undefined arguments rather than behind
  // an `if`: a hook cannot be conditional, and the hook itself no-ops on a
  // built-in or a style that has not loaded.
  const libraryKey = style && !BUILT_IN.has(style.font_key) ? style.font_key : undefined;
  useInjectedFontFace(libraryKey, style?.font_family);

  // useLayoutEffect: measure before paint, or the first caption renders at a
  // scale of zero and visibly jumps.
  //
  // This observes the *frame*, which has no padding of its own, so the height it
  // reports is the frame's height and nothing else. The border-box reading is
  // kept because it is the correct one, but the loop it was fixing is now gone
  // by construction — the element carrying the margins is no longer this one.
  useLayoutEffect(() => {
    const node = frame.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      const border = entry.borderBoxSize?.[0]?.blockSize;
      setHeight(border ?? entry.target.getBoundingClientRect().height);
    });
    observer.observe(node);
    setHeight(node.getBoundingClientRect().height);

    return () => observer.disconnect();
  }, []);

  const scale = style ? scaleFor(height, style.reference_height) : 0;

  /**
   * Re-assert the live drag position after any render that happened mid-drag.
   *
   * A drag writes the caption's position straight to the DOM, which React knows
   * nothing about — so a render it did not cause (the playhead moving on to the
   * next caption, most often) would repaint the box from the style in the cache
   * and yank it back to wherever the drag started. No dependency array on
   * purpose: this has to run after *every* render, not after a chosen few.
   */
  useLayoutEffect(() => {
    if (!dragging || !style) return;
    const node = boxEl.current;
    if (node && live.current) applyFreePosition(node, live.current, style);
  });

  /**
   * The caption's rendered text box, as fractions of the frame.
   *
   * The *text* element, not the box around it. In free placement the two are
   * nearly the same, but an anchored caption is laid out by a full-bleed flex
   * container whose element is the whole frame — measuring that would report
   * the frame and say nothing about where the words are.
   *
   * Null when there is no caption on screen, which is most of a video.
   */
  function textBox(rect: DOMRect): BoxFraction | null {
    const box = textEl.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return { width: box.width / rect.width, height: box.height / rect.height };
  }

  /** The caption's current anchor and size, as fractions of the frame. */
  function measure(rect: DOMRect): { anchor: FreePlacement; size: BoxFraction } {
    const size = textBox(rect) ?? { width: 0, height: 0 };
    const box = textEl.current?.getBoundingClientRect();

    // Read the anchor off the pixels, whichever mode the style is in.
    //
    // Deriving it from `pos_x`/`pos_y` would be right too, but only in free
    // placement — and the case that matters is the *first* drag, when the
    // caption is still anchored. Doing it this way means picking a caption up
    // never moves it, instead of moving it by half its own height, which is
    // what computing the anchor from the margins alone would do: those say
    // where the caption's *edge* is, and the anchor is its centre.
    if (box && size.width > 0 && style) {
      return {
        anchor: {
          pos_x:
            (box.left - rect.left) / rect.width + ANCHOR_SHIFT[style.alignment] * size.width,
          pos_y: (box.top - rect.top) / rect.height + size.height / 2,
        },
        size,
      };
    }

    // Nothing on screen to measure — a gap between captions. Fall back to the
    // fields doing the positioning. Any error here is invisible by definition,
    // and the drag about to happen overwrites it.
    const current = style ? freePosition(style) : null;
    if (current) return { anchor: { pos_x: current.x, pos_y: current.y }, size };

    return {
      anchor: style
        ? anchorFromStyle(
            style.position,
            style.alignment,
            style.margin_v,
            style.margin_h,
            rect.width / rect.height,
            style.reference_height
          )
        : { pos_x: 0.5, pos_y: 0.5 },
      size,
    };
  }

  /**
   * Draw the drag, at frame rate, without telling React.
   *
   * The old version called `onPlace` on every pointer event, and `onPlace`
   * writes the style into the query cache — so a mouse reporting at 1000Hz
   * re-rendered the player, the style panel and the caption list a thousand
   * times a second to move one box. That is the whole of the "jittery and
   * laggy" complaint: not a slow renderer, just far too many renders.
   */
  function paint() {
    painting.current = null;
    const g = grab.current;
    const pointer = latest.current;
    const node = boxEl.current;
    if (!g || !pointer || !node || !style) return;

    // A caption that was not on screen when the drag started has no size, so
    // nothing was clamping it to the frame. It can appear mid-drag — the
    // playhead runs on into the next caption while the pointer is still down —
    // so take the measurement the moment there is something to measure.
    if (g.size.width === 0) {
      const appeared = textBox(g.frame);
      if (appeared) g.size = appeared;
    }

    const next = clampPlacement(
      g.anchorX + (pointer.x - g.pointerX) / g.frame.width,
      g.anchorY + (pointer.y - g.pointerY) / g.frame.height,
      g.size,
      style.alignment
    );

    live.current = next;
    applyFreePosition(node, next, style);
    if (readout.current) {
      readout.current.textContent = `${Math.round(next.pos_x * 100)}% · ${Math.round(next.pos_y * 100)}%`;
    }
  }

  function handlePointerDown(event: React.PointerEvent) {
    const node = frame.current;
    if (!node || !style || !onPlace) return;

    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    // Pointer capture, so a fast drag that leaves the video — or the window —
    // keeps delivering moves to this element instead of silently ending.
    event.currentTarget.setPointerCapture(event.pointerId);

    const { anchor, size } = measure(rect);
    grab.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      anchorX: anchor.pos_x,
      anchorY: anchor.pos_y,
      frame: rect,
      size,
    };
    live.current = anchor;
    moved.current = false;
  }

  function handlePointerMove(event: React.PointerEvent) {
    const g = grab.current;
    if (!g) return;

    if (!moved.current) {
      const far =
        Math.abs(event.clientX - g.pointerX) > DRAG_THRESHOLD ||
        Math.abs(event.clientY - g.pointerY) > DRAG_THRESHOLD;
      if (!far) return;
      moved.current = true;

      // The one render a drag needs: it switches an anchored caption into free
      // placement, at the exact anchor it was already drawing at, so nothing
      // moves. Without it the box is still a full-bleed flex container and
      // writing `left`/`top` to it would do nothing at all.
      setDragging(true);
      if (live.current) onPlace?.(live.current);
    }

    latest.current = { x: event.clientX, y: event.clientY };
    // Coalesce: a pointer can report several times per frame, and only the last
    // position of a frame is worth drawing.
    if (painting.current === null) painting.current = requestAnimationFrame(paint);
  }

  /** Shared by release and cancel: stop drawing and forget the drag. */
  function endDrag(event: React.PointerEvent) {
    // Guarded, because `pointerdown` can bail before capturing — a zero-sized
    // frame, or a style that has not loaded — and releasing a capture that was
    // never taken throws NotFoundError.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (painting.current !== null) {
      cancelAnimationFrame(painting.current);
      painting.current = null;
    }

    grab.current = null;
    latest.current = null;
    setDragging(false);
  }

  function handlePointerUp(event: React.PointerEvent) {
    const dragged = moved.current;
    const placement = live.current;
    moved.current = false;
    endDrag(event);

    // A press that never moved is a click, and on a video a click means play.
    // The drag surface covers the whole frame, so without this the <video>
    // underneath never sees it and the player stops responding to clicks.
    if (!dragged) onToggle?.();
    else if (placement) onPlace?.(placement);
  }

  /**
   * The gesture was taken away — the browser claiming it for a scroll, or the
   * pointer being disconnected. Not a click, so it must not toggle playback,
   * and not a completed drag either. Whatever the caption reached is left
   * where it is: the move that got it there was already saved on the way in.
   */
  function handlePointerCancel(event: React.PointerEvent) {
    const dragged = moved.current;
    const placement = live.current;
    moved.current = false;
    endDrag(event);
    if (dragged && placement) onPlace?.(placement);
  }

  const draggable = Boolean(onPlace && style);
  const placed = style ? freePosition(style) !== null : false;

  return (
    <div ref={frame} className="pointer-events-none absolute inset-0">
      {/*
        The whole frame is the handle, not the caption.

        Dragging the caption text meant aiming at one line of type — and at
        nothing at all when the playhead sits in a gap between captions, which
        is most of a video.

        It no longer *jumps* to the pointer, though. The caption moves by the
        distance the pointer moves, from wherever it already was, so grabbing it
        anywhere picks it up exactly where it sits. Landing the caption under
        the cursor was the old behaviour and it made every drag start with a
        lurch, including the ones that were only ever going to be a click.
      */}
      {draggable && (
        <div
          className={dragging ? "absolute inset-0 cursor-grabbing" : "absolute inset-0 cursor-grab"}
          style={{ pointerEvents: "auto", touchAction: "none" }}
          title="Drag to place the caption · click to play"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        />
      )}

      {/* Centre lines, shown only while dragging. Not a grid and not a snap
          target — there is nothing to snap to any more. They are here because
          "is this actually centred" is the one question a freehand drag cannot
          answer by eye, and the answer used to be guaranteed by the format. */}
      {dragging && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/25" />
          <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/25" />
        </div>
      )}

      {/* Where this drag has got to. Without it the only feedback is the
          caption moving, which does not tell you whether you have landed on
          "halfway across" or a percent off it. Top-left so it is never under
          the cursor doing the dragging.

          Its text is written by `paint`, not by React — putting it in state
          would reintroduce exactly the per-event render the drag avoids. */}
      {dragging && (
        <div
          ref={readout}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/75 px-2 py-1 font-mono text-[11px] tabular-nums text-white shadow-lg"
        />
      )}

      {style && (
        <div
          ref={boxEl}
          className="pointer-events-none"
          style={captionBoxStyle(style, scale)}
          // Only meaningful once the caption is free-placed: an anchored box is
          // the whole frame, and announcing that as a position would be a lie.
          data-placed={placed || undefined}
        >
          {caption && height > 0 && (
            <span ref={textEl} style={captionTextStyle(style, font, scale, caption)}>
              {caption.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
