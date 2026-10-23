"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useDeleteVideo, useLanguageOptions, useRetranscribe } from "@/hooks/use-videos";
import { formatDuration } from "@/lib/format";
import { languageName } from "@/lib/languages";
import { stageLabel } from "@/lib/stages";
import { askToNotify, watchTranscription } from "@/lib/transcription-alerts";
import type { Video } from "@/types/video";

/**
 * The language a video's captions are in, as one word: the caption language,
 * or for "Same as spoken" what was heard.
 */
export function useCaptionLanguage(video: Video): string | null {
  const { data } = useLanguageOptions();
  if (!data) return null;
  if (video.caption_language !== "same") return languageName(video.caption_language, data);
  return video.detected_language ? languageName(video.detected_language, data) : "Same as spoken";
}

/** "Hindi · 0:36 · Ready": the one grey line under a video's title. */
export function useVideoMeta(video: Video): string[] {
  const language = useCaptionLanguage(video);
  const state =
    video.status === "completed"
      ? "Ready"
      : video.status === "failed"
        ? "Failed"
        : video.status === "pending"
          ? "Queued"
          : `${stageLabel(video)} · ${video.progress}%`;
  return [language, video.duration_ms != null ? formatDuration(video.duration_ms) : null, state].filter(
    (part): part is string => Boolean(part)
  );
}

/**
 * What can be done with a video, behind its "…" button: open, search,
 * transcribe again (failed or queued), settings (failed), delete. Delete asks
 * first, in a dialog with the only filled red button in the app.
 */
export function VideoActions({ video, className }: { video: Video; className?: string }) {
  const deleteVideo = useDeleteVideo();
  const retranscribe = useRetranscribe();
  const [confirming, setConfirming] = useState(false);
  const failed = video.status === "failed";

  function retry() {
    // Keep the video's languages, ask to notify on the click (browsers only
    // prompt in response to one), and watch the job.
    askToNotify();
    retranscribe.mutate({ id: video.id }, { onSuccess: () => watchTranscription(video.id) });
  }

  const items: MenuItem[] = [
    { label: "Open", href: `/editor/${video.id}` },
    ...(video.status === "completed" ? [{ label: "Search this video", href: `/search/${video.id}` }] : []),
    ...(failed || video.status === "pending"
      ? [{ label: failed ? "Try again" : "Start now", onSelect: retry, disabled: retranscribe.isPending }]
      : []),
    ...(failed ? [{ label: "Settings", href: "/settings" }] : []),
    { label: "Delete…", onSelect: () => setConfirming(true), destructive: true, disabled: deleteVideo.isPending },
  ];

  return (
    <>
      <Menu label={`More actions for ${video.title}`} items={items} className={className} />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete “${video.title}”?`}
        description="Its captions and exports are deleted too. This can't be undone."
        className="max-w-md"
        bodyClassName="hidden"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              loading={deleteVideo.isPending}
              onClick={() => deleteVideo.mutate(video.id, { onSettled: () => setConfirming(false) })}
            >
              {deleteVideo.isPending ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </>
  );
}
