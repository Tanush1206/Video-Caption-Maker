"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Video, VideoList } from "@/types/video";

export const videoKeys = {
  all: ["videos"] as const,
  detail: (id: number) => ["videos", id] as const,
};

export function useVideos() {
  return useQuery({
    queryKey: videoKeys.all,
    queryFn: () => api.get<VideoList>("/api/videos"),
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
    // truth, and the list is small enough that a round-trip is cheap.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: videoKeys.all }),
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
