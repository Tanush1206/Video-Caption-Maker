"use client";

import { useMutation } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { AskResponse, SearchResponse } from "@/types/search";

/**
 * Search and ask are mutations, not queries.
 *
 * They look like reads, but they are *submissions*: nobody wants a search
 * firing on every keystroke, and `ask` costs a model call. Mutations give the
 * "runs when you say so, once" semantics this needs, without fighting
 * refetch-on-focus and cache invalidation for a result that is only ever
 * interesting right after you asked for it.
 *
 * `videoId` of null means the whole library. The backend treats an absent
 * video_id the same way, and resolves the scope from the caller's own rows
 * either way — the id here narrows a search, it never widens one.
 */
export function useSemanticSearch(videoId: number | null) {
  return useMutation({
    mutationFn: (query: string) => {
      const params = new URLSearchParams({ q: query });
      if (videoId !== null) params.set("video_id", String(videoId));
      return api.get<SearchResponse>(`/api/search?${params}`);
    },
  });
}

export function useAsk(videoId: number | null) {
  return useMutation({
    mutationFn: (question: string) =>
      api.post<AskResponse>("/api/ask", { question, video_id: videoId }),
  });
}
