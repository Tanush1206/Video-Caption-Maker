"use client";

import { useMutation } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { TokenResponse, User } from "@/types/auth";

export function useUpdateProfile() {
  return useMutation({
    mutationFn: (full_name: string | null) =>
      api.patch<User>("/api/auth/me", { full_name }),
    onSuccess: (user) => {
      // The header shows this name. Writing it back keeps the whole app in
      // step without a reload, and the access token is untouched by a rename.
      const { accessToken, setSession } = useAuthStore.getState();
      if (accessToken) setSession(user, accessToken);
    },
  });
}

/**
 * Changing a password ends every other session, including this browser's own
 * refresh token — so the response carries a replacement pair, and it has to be
 * adopted or the user is signed out for doing the responsible thing.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: { current_password: string; new_password: string }) =>
      api.post<TokenResponse>("/api/auth/me/password", payload),
    onSuccess: (data) =>
      useAuthStore.getState().setSession(data.user, data.access_token),
  });
}

export function useDeleteAccount() {
  return useMutation({
    // Confirmation goes in the body, not the URL: a password in a query
    // string ends up in browser history and access logs.
    mutationFn: (payload: { password?: string; confirm_email?: string }) =>
      api.delete<void>("/api/auth/me", payload),
  });
}
