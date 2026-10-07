"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { statsKeys } from "@/hooks/use-stats";
import type { CaptionList } from "@/types/caption";
import type { LanguageOptions, Video, VideoList, VideoStatus } from "@/types/video";

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

/**
 * The languages this installation can produce captions in.
 *
 * Served rather than hardcoded so the client cannot offer one the pipeline
 * will not deliver. Fixed for the life of the process, so it is never stale.
 */
export function useLanguageOptions() {
  return useQuery({
    queryKey: ["videos", "languages"] as const,
    queryFn: () => api.get<LanguageOptions>("/api/videos/languages"),
    staleTime: Infinity,
  });
}

export function useRetranscribe() {
  const queryClient = useQueryClient();

  return useMutation({
    // The language fields are optional: sending none re-runs with whatever the
    // video already had, which is what "try that again" means.
    mutationFn: ({
      id,
      ...body
    }: {
      id: number;
      spoken_language?: string;
      caption_language?: string;
    }) => api.post<Video>(`/api/videos/${id}/transcribe`, body),
    onSuccess: (video) => {
      // Write the queued video straight in, rather than only invalidating.
      //
      // Invalidation marks the cache stale and refetches, which leaves a gap
      // where readers still see the *previous* status. For the alert watcher
      // that gap is the difference between waiting for a job and announcing it
      // as finished the instant it starts, because the last thing it had
      // cached said "completed". The response here already is the new state.
      queryClient.setQueryData(videoKeys.detail(video.id), video);

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
    // Without this the editor reads the video once and never again, so a
    // transcription started from it appears to do nothing at all: the status
    // badge stays on whatever was true at mount and the captions on screen
    // stay the ones the job is busy replacing. Reloading the page was the only
    // way to see any of it move, which read as the reload *starting* the job.
    //
    // Same rule as the dashboard list: poll only while something is in flight.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "pending" || status === "processing" ? 2000 : false;
    },
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
