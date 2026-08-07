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
 */
export function useSemanticSearch(videoId: number) {
  return useMutation({
    mutationFn: (query: string) =>
      api.get<SearchResponse>(
        `/api/search?q=${encodeURIComponent(query)}&video_id=${videoId}`
      ),
  });
}

export function useAsk(videoId: number) {
  return useMutation({
    mutationFn: (question: string) =>
      api.post<AskResponse>("/api/ask", { question, video_id: videoId }),
  });
}
