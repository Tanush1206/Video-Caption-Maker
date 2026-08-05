/**
 * Typed API client for the FastAPI backend.
 *
 * Access tokens live in memory (see stores/auth.ts) and are attached as a
 * bearer header. The refresh token is an httpOnly cookie the browser sends
 * automatically to /api/auth, so this file never sees or stores it.
 */

import { useAuthStore } from "@/stores/auth";
import type { TokenResponse } from "@/types/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Internal: stops a retried request from triggering another refresh. */
  _retrying?: boolean;
}

/** Pull a readable message out of FastAPI's {"detail": ...} envelope. */
async function extractError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") return data.detail;
    // 422 from Pydantic: detail is an array of per-field errors.
    if (Array.isArray(data?.detail)) {
      return data.detail
        .map((e: { msg?: string }) => e.msg)
        .filter(Boolean)
        .join(", ");
    }
  } catch {
    // Not JSON — fall through to the status text.
  }
  return response.statusText || "Request failed";
}

/**
 * The in-flight refresh, shared by every caller.
 *
 * Without this, N concurrent 401s would fire N refreshes. Each one rotates
 * the cookie, so the later requests race and some callers get logged out.
 */
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const response = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    useAuthStore.getState().clearSession();
    return null;
  }

  const data: TokenResponse = await response.json();
  useAuthStore.getState().setSession(data.user, data.access_token);
  return data.access_token;
}

export function refreshSession(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, _retrying, ...rest } = options;
  const token = useAuthStore.getState().accessToken;

  const response = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include", // sends the httpOnly refresh cookie
  });

  // Access token expired: refresh once, then replay the original request.
  if (response.status === 401 && !_retrying && !path.startsWith("/api/auth/")) {
    const newToken = await refreshSession();
    if (newToken) {
      return request<T>(path, { ...options, _retrying: true });
    }
  }

  if (!response.ok) {
    throw new ApiError(response.status, await extractError(response));
  }

  // 204 No Content
  if (response.status === 204) return undefined as T;

  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
