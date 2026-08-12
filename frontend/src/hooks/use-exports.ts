"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { startDownload } from "@/lib/download";
import type {
  DownloadTicket,
  ExportFormat,
  ExportList,
  VideoExport,
} from "@/types/export";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const exportKeys = {
  forVideo: (videoId: number) => ["videos", videoId, "exports"] as const,
};

const isBusy = (item: VideoExport) =>
  item.status === "pending" || item.status === "processing";

export function useExports(videoId: number) {
  return useQuery({
    queryKey: exportKeys.forVideo(videoId),
    queryFn: () => api.get<ExportList>(`/api/videos/${videoId}/exports`),
    // Poll only while a render is actually running. Sidecars come back
    // finished, so a list of those polls nothing at all.
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some(isBusy) ? 1500 : false,
  });
}

export function useCreateExport(videoId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (format: ExportFormat) =>
      api.post<VideoExport>(`/api/videos/${videoId}/exports`, { format }),
    // Refetch rather than appending locally: a sidecar comes back completed
    // and a burn comes back pending, and the list has to start polling for the
    // second case. Letting the query decide keeps that in one place.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: exportKeys.forVideo(videoId) }),
  });
}

export function useDeleteExport(videoId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (exportId: number) => api.delete<void>(`/api/exports/${exportId}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: exportKeys.forVideo(videoId) }),
  });
}

/**
 * Fetch a fresh download link and follow it.
 *
 * The token is minted on click rather than alongside the list: it expires in
 * fifteen minutes, so one issued when the page loaded would be dead by the
 * time someone came back to it.
 */
export function useDownloadExport() {
  return useMutation({
    mutationFn: async (exportId: number) => {
      const ticket = await api.post<DownloadTicket>(
        `/api/exports/${exportId}/download-token`
      );
      return `${API_URL}/api/exports/${exportId}/download?token=${encodeURIComponent(
        ticket.token
      )}`;
    },
    onSuccess: startDownload,
  });
}
