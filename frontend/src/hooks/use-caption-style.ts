"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";

import { api } from "@/lib/api";
import type { CaptionStyle, StyleOptions } from "@/types/style";

const SAVE_DELAY_MS = 300;

export const styleKeys = {
  forVideo: (videoId: number) => ["videos", videoId, "style"] as const,
  options: ["styles", "options"] as const,
};

/**
 * The fonts and presets the server will accept.
 *
 * Fetched rather than hardcoded: the list is derived from the fonts actually
 * installed in the worker image, and offering one that isn't there means the
 * export silently renders in a substitute while the preview shows the real
 * thing. Never changes at runtime, so it is cached indefinitely.
 */
export function useStyleOptions() {
  return useQuery({
    queryKey: styleKeys.options,
    queryFn: () => api.get<StyleOptions>("/api/styles/options"),
    staleTime: Infinity,
  });
}

export function useCaptionStyle(videoId: number) {
  return useQuery({
    queryKey: styleKeys.forVideo(videoId),
    queryFn: () => api.get<CaptionStyle>(`/api/videos/${videoId}/style`),
  });
}

/**
 * Edit the style with an instant preview and a debounced save.
 *
 * Dragging a size slider fires a change per pixel of travel. Each one has to
 * reach the preview immediately — that is the entire point of a live preview —
 * but sending each one is a hundred requests for one adjustment.
 *
 * So the cache is written synchronously, which re-renders the overlay, and the
 * accumulated patch is sent once the user stops moving.
 */
export function useUpdateCaptionStyle(videoId: number) {
  const queryClient = useQueryClient();
  const key = styleKeys.forVideo(videoId);

  const pending = useRef<Partial<CaptionStyle>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Which save is the newest. Responses are not guaranteed to come back in the
  // order they were sent, and an older one carries an older style.
  const latest = useRef(0);

  const mutation = useMutation({
    mutationFn: ({ patch }: { patch: Partial<CaptionStyle>; seq: number }) =>
      api.patch<CaptionStyle>(`/api/videos/${videoId}/style`, patch),
    onSuccess: (saved, { seq }) => {
      // A newer save is already out. Applying this reply would drag every
      // slider back to where it was when this request left.
      if (seq < latest.current) return;

      // Otherwise the server's copy wins, because it has applied the column
      // bounds — a value clamped server-side must snap back visibly rather
      // than leave the preview showing something that was never saved.
      //
      // But only for fields the user is not still editing. `pending` holds
      // everything changed since this request went out, and re-applying it on
      // top is what stops a mid-drag response from fighting the thumb.
      queryClient.setQueryData<CaptionStyle>(key, { ...saved, ...pending.current });
    },
  });

  // `mutation.mutate` is stable across renders — it is a useCallback bound to
  // the observer. The mutation *object* is not: useMutation returns a fresh
  // `{ ...result, mutate, mutateAsync }` literal every time. Depending on the
  // object made `flush` change identity on every render, which re-ran the
  // unmount effect below and therefore fired its cleanup — so every keystroke
  // of a drag saved immediately and the debounce never once took effect.
  const { mutate } = mutation;

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;

    latest.current += 1;
    mutate({ patch, seq: latest.current });
  }, [mutate]);

  const update = useCallback(
    (patch: Partial<CaptionStyle>) => {
      // Straight into the cache, so the overlay redraws this frame.
      queryClient.setQueryData<CaptionStyle>(key, (old) =>
        old ? { ...old, ...patch } : old
      );

      // Merged, not replaced: moving two sliders inside one window must send
      // both changes, not just the last one.
      pending.current = { ...pending.current, ...patch };

      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
    [flush, key, queryClient]
  );

  // A style change still sitting in the debounce window when the editor
  // unmounts would otherwise be lost. Read through a ref with an empty
  // dependency list, so this means "on unmount" and cannot quietly become
  // "after every render" again if `flush` ever picks up an unstable
  // dependency — which is the failure this hook already had once.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), []);

  return { update, isSaving: mutation.isPending };
}

/** Presets and reset replace the whole style, so they use the response as-is. */
function useReplacingMutation(
  videoId: number,
  fn: (arg: string) => Promise<CaptionStyle>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: (saved) =>
      queryClient.setQueryData(styleKeys.forVideo(videoId), saved),
  });
}

export function useApplyPreset(videoId: number) {
  return useReplacingMutation(videoId, (name: string) =>
    api.post<CaptionStyle>(`/api/videos/${videoId}/style/preset`, { name })
  );
}

export function useResetStyle(videoId: number) {
  return useReplacingMutation(videoId, () =>
    api.delete<CaptionStyle>(`/api/videos/${videoId}/style`)
  );
}
