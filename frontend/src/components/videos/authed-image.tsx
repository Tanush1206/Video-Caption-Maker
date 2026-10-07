"use client";

import { useEffect, useState } from "react";

import { useAuthStore } from "@/stores/auth";
import { refreshSession } from "@/lib/api";

import { API_URL } from "@/lib/config";

interface AuthedImageProps {
  path: string;
  alt: string;
  className?: string;
  fallback?: React.ReactNode;
}

/**
 * An <img> for endpoints that require a bearer token.
 *
 * A plain <img src> cannot carry an Authorization header, and the access
 * token lives in memory rather than a cookie, so the browser has nothing to
 * attach on its own. The fix is to fetch the bytes ourselves and hand the
 * element a blob: URL.
 *
 * The alternative — putting a token in the query string — would leak it into
 * server logs and Referer headers.
 */
export function AuthedImage({ path, alt, className, fallback }: AuthedImageProps) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!accessToken) return;

    // Guards against a slow response for an unmounted component overwriting
    // state, and against an out-of-order response for a previous path.
    let cancelled = false;
    let created: string | null = null;

    const load = async () => {
      try {
        let response = await fetch(`${API_URL}${path}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          credentials: "include",
        });

        if (response.status === 401) {
          const token = await refreshSession();
          if (!token) throw new Error("unauthorized");
          response = await fetch(`${API_URL}${path}`, {
            headers: { Authorization: `Bearer ${token}` },
            credentials: "include",
          });
        }

        if (!response.ok) throw new Error(String(response.status));

        created = URL.createObjectURL(await response.blob());
        if (cancelled) {
          URL.revokeObjectURL(created);
          return;
        }
        setObjectUrl(created);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
      // Blob URLs are held by the document until revoked; without this every
      // re-render of a long list would leak the image's memory.
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, accessToken]);

  if (failed || !objectUrl) return <>{fallback ?? null}</>;

  // blob: URLs cannot go through next/image, which needs a static or
  // remote-configured source.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl} alt={alt} className={className} />;
}
