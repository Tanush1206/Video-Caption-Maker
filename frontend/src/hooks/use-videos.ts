"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { statsKeys } from "@/hooks/use-stats";
import type { CaptionList } from "@/types/caption";
import type { Video, VideoList, VideoStatus } from "@/types/video";

/** One screenful on a wide monitor: 4 columns × 3 rows, and 2 or 3 on smaller. */
export const PAGE_SIZE = 12;

export const videoKeys = {
  all: ["videos"] as const,
  list: (page: number, status: VideoStatus | null) => ["videos", "list", page, status] as const,
  detail: (id: number) => ["videos", id] as const,
};

export function useVideos(page = 0, status: VideoStatus | null = null) {
  return useQuery({
    queryKey: videoKeys.list(page, status),
    queryFn: () => {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
      });
      if (status) params.set("status", status);
      return api.get<VideoList>(`/api/videos?${params}`);
    },
    // Each page is a separate cache entry, so paging forward would normally
    // blank the grid and collapse the layout while the next one loads. This
    // keeps the previous page on screen until the new one lands.
    placeholderData: keepPreviousData,
    // Poll only while something is actually moving. Returning false when
    // nothing is in flight stops an idle dashboard hammering the API.
    //
    // Polling rather than websockets/SSE: progress changes a few times a
    // minute, so a 2-second poll is far simpler than a persistent connection
    // plus its reconnection and auth handling. Revisit if it gets chattier.
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const busy = items.some((v) => v.status === "pending" || v.status === "processing");
      return busy ? 2000 : false;
    },
  });
}

export function useRetranscribe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.post<Video>(`/api/videos/${id}/transcribe`),
    onSuccess: () => {
      // videoKeys.all is a prefix of every page key, so one call clears them
      // all — a video moving between statuses can change which page it is on.
      void queryClient.invalidateQueries({ queryKey: videoKeys.all });
      void queryClient.invalidateQueries({ queryKey: statsKeys.all });
    },
  });
}

export function useCaptions(videoId: number, enabled = true) {
  return useQuery({
    queryKey: [...videoKeys.detail(videoId), "captions"],
    queryFn: () => api.get<CaptionList>(`/api/videos/${videoId}/captions`),
    enabled,
  });
}

export function useVideo(id: number) {
  return useQuery({
    queryKey: videoKeys.detail(id),
    queryFn: () => api.get<Video>(`/api/videos/${id}`),
  });
}

export function useDeleteVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/api/videos/${id}`),
    // Refetch rather than trusting a local edit: the server is the source of
    // truth, and with pagination a deletion pulls a video from the next page
    // onto this one — something no local splice can know about.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: videoKeys.all });
      void queryClient.invalidateQueries({ queryKey: statsKeys.all });
    },
  });
}

export function useRenameVideo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: number; title: string }) =>
      api.patch<Video>(`/api/videos/${id}`, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: videoKeys.all }),
  });
}
