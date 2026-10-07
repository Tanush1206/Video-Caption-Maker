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

import { API_URL } from "@/lib/config";

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
  if (xhr.status === 0) return "The upload was interrupted. Check that the app is running and try again.";
  return xhr.status >= 500
    ? "The app's server couldn't take the upload. Try again in a moment."
    : `Upload failed (${xhr.status})`;
}

function send(
  file: File,
  token: string | null,
  onProgress: (percent: number) => void,
  captionLanguage?: string
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
    // Before the file, so the server has the choice in hand when the bytes
    // arrive; the one transcription that follows produces those captions.
    if (captionLanguage) form.append("caption_language", captionLanguage);
    form.append("file", file);
    xhr.send(form);
  });

  return { xhr, promise };
}

export function uploadVideo(
  file: File,
  onProgress: (percent: number) => void,
  captionLanguage?: string
): UploadHandle {
  let active: XMLHttpRequest | null = null;

  const run = async (): Promise<Video> => {
    const first = send(file, useAuthStore.getState().accessToken, onProgress, captionLanguage);
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
      const retry = send(file, token, onProgress, captionLanguage);
      active = retry.xhr;
      return await retry.promise;
    }
  };

  return { promise: run(), cancel: () => active?.abort() };
}
