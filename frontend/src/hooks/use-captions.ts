"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { videoKeys } from "@/hooks/use-videos";
import type { Caption, CaptionList, CaptionPair } from "@/types/caption";

export const captionKeys = {
  forVideo: (videoId: number) => ["videos", videoId, "captions"] as const,
};

export function useVideoCaptions(videoId: number) {
  return useQuery({
    queryKey: captionKeys.forVideo(videoId),
    queryFn: () => api.get<CaptionList>(`/api/videos/${videoId}/captions`),
  });
}

/**
 * Text edits are saved optimistically: the cache is updated immediately and
 * rolled back if the request fails. Waiting for a round-trip on every
 * keystroke-triggered autosave would make typing feel laggy.
 */
export function useUpdateCaption(videoId: number) {
  const queryClient = useQueryClient();
  const key = captionKeys.forVideo(videoId);

  return useMutation({
    mutationFn: ({ id, ...patch }: { id: number } & Partial<Caption>) =>
      api.patch<Caption>(`/api/captions/${id}`, patch),

    onMutate: async ({ id, ...patch }) => {
      // Stop an in-flight refetch from landing after our optimistic write and
      // reinstating the old text.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<CaptionList>(key);

      queryClient.setQueryData<CaptionList>(key, (old) =>
        old
          ? {
              ...old,
              items: old.items.map((c) => (c.id === id ? { ...c, ...patch } : c)),
            }
          : old
      );

      return { previous };
    },

    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
  });
}

/** A caption is emphasised as one gesture, so all three move together. */
export const EMPHASIS: Pick<Caption, "override_color" | "override_bold" | "override_scale"> =
  {
    override_color: "#FFD400",
    override_bold: true,
    override_scale: 1.15,
  };

/**
 * Explicit nulls, not an empty object.
 *
 * The API distinguishes "clear this override" from "I didn't mention it", so
 * omitting the keys would leave the emphasis exactly where it was.
 */
export const NO_EMPHASIS: Pick<
  Caption,
  "override_color" | "override_bold" | "override_scale"
> = {
  override_color: null,
  override_bold: null,
  override_scale: null,
};

/** Split, merge and delete change ids and ordering, so just refetch. */
function useStructuralMutation<TArgs, TResult>(
  videoId: number,
  fn: (args: TArgs) => Promise<TResult>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: captionKeys.forVideo(videoId) });
      // The dashboard shows caption-derived state, so keep it honest too.
      void queryClient.invalidateQueries({ queryKey: videoKeys.all });
    },
  });
}

export function useSplitCaption(videoId: number) {
  return useStructuralMutation(videoId, ({ id, atMs }: { id: number; atMs: number }) =>
    api.post<CaptionPair>(`/api/captions/${id}/split`, { at_ms: atMs })
  );
}

export function useMergeCaption(videoId: number) {
  return useStructuralMutation(videoId, (id: number) =>
    api.post<Caption>(`/api/captions/${id}/merge-next`)
  );
}

export function useDeleteCaption(videoId: number) {
  return useStructuralMutation(videoId, (id: number) =>
    api.delete<void>(`/api/captions/${id}`)
  );
}

/**
 * Add a caption by hand.
 *
 * A structural mutation like split and merge, not an optimistic one: the
 * server decides the `sequence` by where the caption lands on the clock, and
 * every row after it shifts. Guessing that locally and reconciling afterwards
 * would be a second implementation of the ordering rule, kept in step by hope.
 */
export function useCreateCaption(videoId: number) {
  return useStructuralMutation(
    videoId,
    (body: { start_ms: number; end_ms: number; text: string }) =>
      api.post<Caption>(`/api/videos/${videoId}/captions`, body)
  );
}
