"use client";

import { create } from "zustand";

import type { User } from "@/types/auth";

interface AuthState {
  user: User | null;
  /**
   * Kept in memory only. Persisting it to localStorage would hand it to any
   * XSS payload; on reload we silently re-acquire one from the refresh cookie.
   */
  accessToken: string | null;
  /** False until the initial refresh attempt settles, so guards don't redirect early. */
  initialized: boolean;
  setSession: (user: User, accessToken: string) => void;
  setUser: (user: User) => void;
  clearSession: () => void;
  setInitialized: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  initialized: false,
  setSession: (user, accessToken) => set({ user, accessToken, initialized: true }),
  setUser: (user) => set({ user }),
  clearSession: () => set({ user: null, accessToken: null, initialized: true }),
  setInitialized: (initialized) => set({ initialized }),
}));

/** Read the token outside React — the API client is not a component. */
export const getAccessToken = () => useAuthStore.getState().accessToken;
