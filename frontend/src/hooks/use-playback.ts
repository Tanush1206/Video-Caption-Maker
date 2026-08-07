"use client";

/**
 * The editor's playback controller.
 *
 * The design problem here is update frequency. A playhead that only moves when
 * React re-renders looks broken, but re-rendering an editor full of caption
 * rows sixty times a second is a waste of a frame budget — and text inputs
 * lose responsiveness while it happens.
 *
 * So this hook splits the two rates apart:
 *
 *   - High frequency (every animation frame): published to subscribers, which
 *     write straight to the DOM — a transform on the playhead, textContent on
 *     the clock. React never sees these.
 *   - Low frequency (a few times a second at most): kept in React state —
 *     is it playing, how long is it, which caption is under the playhead.
 *
 * `subscribe` is what makes that possible without prop-drilling a ref.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Caption } from "@/types/caption";

/**
 * Browsers expose no way to read a video's real frame rate, so frame stepping
 * has to assume one. 30 is the common case; on 24 or 60fps footage a "frame"
 * step lands slightly off, which is close enough for positioning a caption.
 */
export const ASSUMED_FPS = 30;

export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

export type TimeListener = (ms: number) => void;

export interface Playback {
  /** Callback ref — pass to the <video> element. */
  attach: (node: HTMLVideoElement | null) => void;
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;
  durationMs: number;
  /** The video's real pixel dimensions, once metadata has loaded. */
  intrinsic: { width: number; height: number } | null;
  playbackRate: number;
  activeCaptionId: number | null;
  /** Read the playhead imperatively, for handlers that shouldn't re-render. */
  currentMs: () => number;
  subscribe: (listener: TimeListener) => () => void;
  toggle: () => void;
  toggleMute: () => void;
  changeVolume: (value: number) => void;
  seekMs: (ms: number) => void;
  stepFrames: (frames: number) => void;
  changeRate: (rate: number) => void;
}

/**
 * Which caption covers `ms`, or null in the silence between two.
 *
 * Binary search rather than `.find()`: this runs on every animation frame, and
 * a linear scan over a long transcript is real work to repeat 60 times a
 * second. Captions arrive ordered by sequence, which is also time order.
 */
function findCaptionAt(captions: Caption[], ms: number): number | null {
  let low = 0;
  let high = captions.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const caption = captions[mid];

    if (ms < caption.start_ms) high = mid - 1;
    else if (ms >= caption.end_ms) low = mid + 1;
    else return caption.id;
  }

  return null;
}

export function usePlayback(
  captions: Caption[],
  fallbackDurationMs: number | null
): Playback {
  const video = useRef<HTMLVideoElement | null>(null);
  const listeners = useRef(new Set<TimeListener>());
  const frame = useRef<number | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [durationMs, setDurationMs] = useState(fallbackDurationMs ?? 0);
  const [intrinsic, setIntrinsic] = useState<{ width: number; height: number } | null>(
    null
  );
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeCaptionId, setActiveCaptionId] = useState<number | null>(null);

  // Read inside the rAF loop, which must not be torn down and rebuilt every
  // time a caption is edited.
  const captionsRef = useRef(captions);
  captionsRef.current = captions;

  // Mirrors activeCaptionId so the loop can compare without a stale closure,
  // and without listing it as a dependency.
  const activeRef = useRef<number | null>(null);

  const currentMs = useCallback(() => (video.current?.currentTime ?? 0) * 1000, []);

  const publish = useCallback((ms: number) => {
    listeners.current.forEach((listener) => listener(ms));

    const next = findCaptionAt(captionsRef.current, ms);
    if (next !== activeRef.current) {
      activeRef.current = next;
      setActiveCaptionId(next); // the one React update per caption boundary
    }
  }, []);

  const stopLoop = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
  }, []);

  const loop = useCallback(() => {
    const node = video.current;
    if (node) publish(node.currentTime * 1000);
    frame.current = requestAnimationFrame(loop);
  }, [publish]);

  const startLoop = useCallback(() => {
    // Guard against double-starting: `play` can fire more than once, and two
    // concurrent loops would double the work and leak one on cleanup.
    if (frame.current === null) frame.current = requestAnimationFrame(loop);
  }, [loop]);

  const subscribe = useCallback(
    (listener: TimeListener) => {
      listeners.current.add(listener);
      // Paint once immediately, or a subscriber mounting during playback shows
      // a stale position until the next frame — and one mounting while paused
      // would never be called at all.
      listener(currentMs());
      return () => {
        listeners.current.delete(listener);
      };
    },
    [currentMs]
  );

  /**
   * Wire the element up as a callback ref rather than an effect on
   * `videoRef.current`. Mutating a ref doesn't re-run effects, so an effect
   * would attach its listeners on whichever render happened to follow the
   * mount — or never, if none did.
   */
  const attach = useCallback(
    (node: HTMLVideoElement | null) => {
      const previous = video.current;
      if (previous) {
        previous.onplay = null;
        previous.onpause = null;
        previous.onended = null;
        previous.onseeked = null;
        previous.ontimeupdate = null;
        previous.onratechange = null;
        previous.ondurationchange = null;
        previous.onloadedmetadata = null;
        previous.onvolumechange = null;
      }

      video.current = node;
      if (!node) {
        stopLoop();
        return;
      }

      const readMetadata = () => {
        // Infinity or NaN until the browser knows; the database value we
        // probed with ffprobe on upload is a better answer than zero.
        const seconds = node.duration;
        // Rounded, because `duration * 1000` is a float and every millisecond
        // value derived from it inherits the noise.
        if (Number.isFinite(seconds) && seconds > 0) {
          setDurationMs(Math.round(seconds * 1000));
        }
        if (node.videoWidth > 0) {
          setIntrinsic({ width: node.videoWidth, height: node.videoHeight });
        }
      };

      node.onloadedmetadata = readMetadata;
      node.ondurationchange = readMetadata;
      node.onplay = () => {
        setIsPlaying(true);
        startLoop();
      };
      node.onpause = () => {
        setIsPlaying(false);
        stopLoop();
        publish(node.currentTime * 1000); // land exactly where we stopped
      };
      node.onended = () => {
        setIsPlaying(false);
        stopLoop();
      };
      // The loop is not running while paused, so these events are the only
      // thing that moves the playhead after a scrub or a buffer stall.
      node.onseeked = () => publish(node.currentTime * 1000);
      node.ontimeupdate = () => {
        if (node.paused) publish(node.currentTime * 1000);
      };
      node.onratechange = () => setPlaybackRate(node.playbackRate);
      node.onvolumechange = () => {
        setIsMuted(node.muted);
        setVolume(node.volume);
      };
    },
    [publish, startLoop, stopLoop]
  );

  const seekMs = useCallback(
    (ms: number) => {
      const node = video.current;
      if (!node) return;

      const limit = Number.isFinite(node.duration) ? node.duration * 1000 : durationMs;
      const target = Math.max(0, Math.min(ms, limit));

      node.currentTime = target / 1000;
      // Don't wait for `seeked`: it can be a frame or two away, and the delay
      // is visible as a lag between clicking a caption and the playhead moving.
      publish(target);
    },
    [durationMs, publish]
  );

  const toggle = useCallback(() => {
    const node = video.current;
    if (!node) return;

    if (node.paused) {
      // Rejects when the browser blocks playback (autoplay policy, no source).
      // Nothing to do about it here, but an unhandled rejection is noise.
      void node.play().catch(() => undefined);
    } else {
      node.pause();
    }
  }, []);

  const stepFrames = useCallback(
    (frames: number) => {
      const node = video.current;
      if (!node) return;
      // Stepping only makes sense against a still image.
      if (!node.paused) node.pause();
      seekMs(node.currentTime * 1000 + (frames * 1000) / ASSUMED_FPS);
    },
    [seekMs]
  );

  const toggleMute = useCallback(() => {
    const node = video.current;
    if (node) node.muted = !node.muted; // `volumechange` updates the state
  }, []);

  const changeVolume = useCallback((value: number) => {
    const node = video.current;
    if (!node) return;
    node.volume = Math.max(0, Math.min(1, value));
    // Dragging the slider up is an unambiguous request to hear something, so
    // don't leave it silently muted.
    if (node.volume > 0) node.muted = false;
  }, []);

  const changeRate = useCallback((rate: number) => {
    const node = video.current;
    if (node) node.playbackRate = rate; // `ratechange` updates the state
  }, []);

  // A split or merge changes which caption covers the current instant without
  // the playhead moving at all, so recompute when the list changes.
  useEffect(() => {
    publish(currentMs());
  }, [captions, currentMs, publish]);

  // Navigating away mid-playback would otherwise leave the loop scheduling
  // frames against an unmounted component forever.
  useEffect(() => stopLoop, [stopLoop]);

  return {
    attach,
    isPlaying,
    isMuted,
    volume,
    durationMs,
    intrinsic,
    playbackRate,
    activeCaptionId,
    currentMs,
    subscribe,
    toggle,
    toggleMute,
    changeVolume,
    seekMs,
    stepFrames,
    changeRate,
  };
}
