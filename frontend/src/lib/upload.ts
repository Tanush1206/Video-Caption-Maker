/**
 * File upload with progress reporting.
 *
 * Uses XMLHttpRequest rather than fetch, which still cannot report *upload*
 * progress — fetch's streaming support covers responses, not request bodies.
 * For a 2GB video, a progress bar isn't a nicety, so XHR it is.
 */

import { refreshSession } from "@/lib/api";
import { useAuthStore } from "@/stores/auth";
import type { Video } from "@/types/video";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export interface UploadHandle {
  promise: Promise<Video>;
  /** Aborts the in-flight request; the backend deletes the partial file. */
  cancel: () => void;
}

function parseError(xhr: XMLHttpRequest): string {
  try {
    const detail = JSON.parse(xhr.responseText)?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      return detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join(", ");
    }
  } catch {
    // not JSON
  }
  return xhr.status === 0 ? "Upload was interrupted" : `Upload failed (${xhr.status})`;
}

function send(
  file: File,
  token: string | null,
  onProgress: (percent: number) => void
): { xhr: XMLHttpRequest; promise: Promise<Video> } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<Video>((resolve, reject) => {
    xhr.open("POST", `${API_URL}/api/videos`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    // Deliberately no Content-Type: the browser must set it so the multipart
    // boundary matches the body it generates.
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Video);
        } catch {
          reject(new Error("Server returned an unreadable response"));
        }
      } else {
        const error = new Error(parseError(xhr));
        (error as Error & { status?: number }).status = xhr.status;
        reject(error);
      }
    };

    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));

    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });

  return { xhr, promise };
}

export function uploadVideo(
  file: File,
  onProgress: (percent: number) => void
): UploadHandle {
  let active: XMLHttpRequest | null = null;

  const run = async (): Promise<Video> => {
    const first = send(file, useAuthStore.getState().accessToken, onProgress);
    active = first.xhr;

    try {
      return await first.promise;
    } catch (error) {
      // A long upload can outlive a 30-minute access token. Refresh and send
      // it again rather than making the user re-pick the file.
      if ((error as { status?: number }).status !== 401) throw error;

      const token = await refreshSession();
      if (!token) throw error;

      onProgress(0);
      const retry = send(file, token, onProgress);
      active = retry.xhr;
      return await retry.promise;
    }
  };

  return { promise: run(), cancel: () => active?.abort() };
}
