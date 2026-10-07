"use client";

import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { captionKeys } from "@/hooks/use-captions";
import { videoKeys } from "@/hooks/use-videos";
import { api } from "@/lib/api";
import {
  getWatched,
  getWatchedOnServer,
  notify,
  subscribeWatched,
  unwatchTranscription,
} from "@/lib/transcription-alerts";
import type { Video } from "@/types/video";

/** Often enough to feel immediate, rare enough to ignore on an idle tab. */
const POLL_MS = 3000;

/**
 * Follow the transcriptions this user asked to be told about, wherever they
 * are in the app.
 *
 * Mounted once, in the dashboard layout, so it keeps running as the user moves
 * between pages — a watcher living on the page that started the job would stop
 * watching the moment they navigated away, which is precisely when they need
 * it.
 *
 * It polls the *detail* endpoint per watched id rather than scanning the video
 * list. The list is newest-first and paginated, so re-transcribing a video
 * from last week would leave it several pages deep and invisible to a watcher
 * that only ever looked at page one.
 *
 * The query key is `videoKeys.detail`, deliberately: the editor reads the same
 * key, so a video open in one tab of the app gets live status out of this poll
 * for free instead of running a second one.
 */
export function useTranscriptionAlerts(): void {
  const router = useRouter();
  const queryClient = useQueryClient();

  const watched = useSyncExternalStore(subscribeWatched, getWatched, getWatchedOnServer);

  /**
   * Ids already announced.
   *
   * Finishing removes the id from the watch list, which unmounts the query and
   * would normally be enough. This is for the window before that state change
   * lands — and for React's development double-invocation of effects, which
   * otherwise fires every notification twice.
   */
  const announced = useRef(new Set<number>());

  const results = useQueries({
    queries: watched.map((id) => ({
      queryKey: videoKeys.detail(id),
      queryFn: () => api.get<Video>(`/api/videos/${id}`),
      refetchInterval: POLL_MS,
      // The job runs on the server whether or not this tab is visible, and the
      // answer is wanted the moment focus returns.
      refetchIntervalInBackground: true,
    })),
  });

  useEffect(() => {
    results.forEach((result, index) => {
      const id = watched[index];
      if (id === undefined) return;

      // Errored past its retries — almost always a video deleted while we were
      // waiting. Stop polling something that is not coming back.
      if (result.isError) {
        unwatchTranscription(id);
        return;
      }

      const video = result.data;
      if (!video) return;

      if (video.status === "pending" || video.status === "processing") {
        // Re-transcribing a video that was announced on an earlier run has to
        // be announceable again, or the second job finishes in silence.
        announced.current.delete(id);
        return;
      }

      if (announced.current.has(id)) return;
      announced.current.add(id);

      // The captions on screen are the ones this job just replaced. Only the
      // captions: `videoKeys.detail` is a prefix of this key, so invalidating
      // the video instead would invalidate the query driving this poll and
      // spin it.
      void queryClient.invalidateQueries({ queryKey: captionKeys.forVideo(id) });
      unwatchTranscription(id);

      const failed = video.status === "failed";
      notify(
        failed ? "Transcription failed" : "Captions are ready",
        failed
          ? `${video.title} — ${video.error_message ?? "something went wrong"}`
          : `${video.title} is transcribed and ready to edit.`,
        () => router.push(`/editor/${id}`)
      );
    });
    // No dependency array: `results` is a fresh array every render, so listing
    // it would change nothing, and every branch above is guarded against
    // running twice.
  });
}
