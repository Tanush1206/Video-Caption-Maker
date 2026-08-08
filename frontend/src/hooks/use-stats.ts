"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Stats } from "@/types/stats";

export const statsKeys = { all: ["stats"] as const };

export function useStats() {
  return useQuery({
    queryKey: statsKeys.all,
    queryFn: () => api.get<Stats>("/api/stats"),
    // Three aggregate queries per call, so this is cheap but not free. Half a
    // minute of staleness is invisible on a counter and stops every remount
    // re-running them.
    staleTime: 30_000,
  });
}
