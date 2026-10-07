"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { SystemInfo, SystemSettingsUpdate } from "@/types/system";

export const systemKeys = { info: ["system"] as const };

/** What the install runs on, and its settings. Cheap, and rarely changes. */
export function useSystem() {
  return useQuery({
    queryKey: systemKeys.info,
    queryFn: () => api.get<SystemInfo>("/api/system"),
    staleTime: 60_000,
  });
}

export function useUpdateSystemSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: SystemSettingsUpdate) =>
      api.patch<SystemInfo>("/api/system/settings", update),
    onSuccess: (info) => queryClient.setQueryData(systemKeys.info, info),
  });
}
