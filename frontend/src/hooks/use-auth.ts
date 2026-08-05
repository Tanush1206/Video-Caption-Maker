"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { api, refreshSession } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { LoginPayload, RegisterPayload, TokenResponse } from "@/types/auth";

export function useAuth() {
  const router = useRouter();
  const { user, accessToken, initialized, setSession, clearSession, setInitialized } =
    useAuthStore();

  const login = useCallback(
    async (payload: LoginPayload) => {
      const data = await api.post<TokenResponse>("/api/auth/login", payload);
      setSession(data.user, data.access_token);
      return data.user;
    },
    [setSession]
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      const data = await api.post<TokenResponse>("/api/auth/register", payload);
      setSession(data.user, data.access_token);
      return data.user;
    },
    [setSession]
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/api/auth/logout");
    } finally {
      // Drop the local session even if the request failed — the user asked
      // to be logged out, so the UI must reflect that either way.
      clearSession();
      router.push("/login");
    }
  }, [clearSession, router]);

  /**
   * Restore a session on first load. The access token only lives in memory,
   * so after a refresh the httpOnly cookie is the only thing left to go on.
   */
  const bootstrap = useCallback(async () => {
    const token = await refreshSession();
    if (!token) setInitialized(true);
  }, [setInitialized]);

  return {
    user,
    accessToken,
    initialized,
    isAuthenticated: Boolean(user && accessToken),
    login,
    register,
    logout,
    bootstrap,
  };
}
