"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { startDownload } from "@/lib/download";
import type { StreamTicket, Waveform } from "@/types/stream";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const streamKeys = {
  ticket: (videoId: number) => ["videos", videoId, "stream-ticket"] as const,
  waveform: (videoId: number) => ["videos", videoId, "waveform"] as const,
};

/**
 * Mint the credential the <video> element's URL carries.
 *
 * Deliberately never refetched on its own: changing a video's `src` reloads
 * the media and drops the playhead back to zero. The player asks for a fresh
 * ticket only when playback actually fails, and restores the position itself.
 */
export function useStreamTicket(videoId: number) {
  return useQuery({
    queryKey: streamKeys.ticket(videoId),
    queryFn: () => api.post<StreamTicket>(`/api/videos/${videoId}/stream-token`),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function streamUrl(videoId: number, token: string): string {
  return `${API_URL}/api/videos/${videoId}/stream?token=${encodeURIComponent(token)}`;
}

/**
 * The same bytes, sent as an attachment.
 *
 * The `download` attribute on an <a> is ignored cross-origin, and the API is a
 * different origin from the app, so the server has to say `Content-Disposition:
 * attachment` itself — hence the flag rather than a client-side hint.
 */
function downloadUrl(videoId: number, token: string, name?: string): string {
  const base = `${streamUrl(videoId, token)}&download=1`;
  // Same reason the flag is a query parameter: the name has to reach the
  // server, because the server is what writes Content-Disposition. It is
  // sanitised there — this end must not assume anything typed here is safe.
  return name ? `${base}&name=${encodeURIComponent(name)}` : base;
}

/**
 * Download the source file, exactly as uploaded.
 *
 * A mutation rather than an <a> built from the player's ticket, so it can sit
 * in the export panel next to the four generated formats — the panel has no
 * business holding a stream credential just to render a link, and the player's
 * ticket is minted once and deliberately never refreshed, so by the time
 * someone finishes editing it may well have expired.
 *
 * Minting on click costs one request and is always valid. This is the only
 * option in that panel that produces no record: there is nothing to render, so
 * there is no export row to keep, poll, or delete afterwards.
 */
export function useDownloadOriginal(videoId: number) {
  return useMutation({
    mutationFn: async (name?: string) => {
      const ticket = await api.post<StreamTicket>(
        `/api/videos/${videoId}/stream-token`
      );
      return downloadUrl(videoId, ticket.token, name);
    },
    onSuccess: startDownload,
  });
}

/**
 * Peaks for the timeline background.
 *
 * The first call for a video runs FFmpeg server-side and can take a few
 * seconds; every call after that reads a cached file. Failure is not
 * retried — a video with no audio will never grow a waveform, and the
 * timeline is designed to work without one.
 */
export function useWaveform(videoId: number) {
  return useQuery({
    queryKey: streamKeys.waveform(videoId),
    queryFn: () => api.get<Waveform>(`/api/videos/${videoId}/waveform`),
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}
