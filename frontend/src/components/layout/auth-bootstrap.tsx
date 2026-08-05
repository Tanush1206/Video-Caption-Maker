"use client";

import { useEffect } from "react";

import { useAuth } from "@/hooks/use-auth";

/**
 * Attempts one silent session restore on mount.
 *
 * Access tokens are held in memory only, so a page reload always starts
 * signed out until the refresh cookie is exchanged for a new one. Rendering
 * nothing itself; it just runs the effect.
 */
export function AuthBootstrap() {
  const { bootstrap } = useAuth();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  return null;
}
