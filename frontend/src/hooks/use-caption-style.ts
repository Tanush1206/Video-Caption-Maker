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

  const mutation = useMutation({
    mutationFn: (patch: Partial<CaptionStyle>) =>
      api.patch<CaptionStyle>(`/api/videos/${videoId}/style`, patch),
    // Trust the server's copy over the optimistic one — it has applied the
    // column bounds, so a value clamped server-side snaps back visibly rather
    // than leaving the preview showing something that was never saved.
    onSuccess: (saved) => queryClient.setQueryData(key, saved),
  });

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length > 0) mutation.mutate(patch);
  }, [mutation]);

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
  // unmounts would otherwise be lost.
  useEffect(() => () => flush(), [flush]);

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
