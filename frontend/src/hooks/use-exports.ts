"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { startDownload } from "@/lib/download";
import type {
  DownloadTicket,
  ExportFormat,
  ExportList,
  ExportOptions,
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

/**
 * The resolutions this video can be burned at, and what will encode them.
 *
 * Served rather than computed here: the ladder depends on the source's own
 * dimensions and on what the *worker* can do, and a client that guessed would
 * eventually offer something the server cannot deliver. Effectively static for
 * a given video, so it is not refetched on focus.
 */
export function useExportOptions(videoId: number) {
  return useQuery({
    queryKey: [...exportKeys.forVideo(videoId), "options"] as const,
    queryFn: () => api.get<ExportOptions>(`/api/videos/${videoId}/exports/options`),
    staleTime: Infinity,
  });
}

export function useCreateExport(videoId: number) {
  const queryClient = useQueryClient();

  return useMutation({
    // An object rather than a bare format, because a burn now also carries the
    // height to render at. Omitting it means the source's own size, which is
    // what the sidecar formats always mean.
    mutationFn: ({ format, height }: { format: ExportFormat; height?: number }) =>
      api.post<VideoExport>(`/api/videos/${videoId}/exports`, { format, height }),
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
    mutationFn: async ({ exportId, name }: { exportId: number; name?: string }) => {
      const ticket = await api.post<DownloadTicket>(
        `/api/exports/${exportId}/download-token`
      );
      const url = `${API_URL}/api/exports/${exportId}/download?token=${encodeURIComponent(
        ticket.token
      )}`;
      // Not folded into the token: the name carries no authority — it decides
      // what the user's own save dialog says and nothing else — and baking it
      // in would mean minting a new token every time they edited the field.
      return name ? `${url}&name=${encodeURIComponent(name)}` : url;
    },
    onSuccess: startDownload,
  });
}
