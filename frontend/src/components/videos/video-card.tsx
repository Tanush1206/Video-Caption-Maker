"use client";

import Link from "next/link";
import { Film } from "lucide-react";

import { AuthedImage } from "@/components/videos/authed-image";
import { VideoActions, useVideoMeta } from "@/components/videos/video-actions";
import { useLanguageOptions } from "@/hooks/use-videos";
import { languageName } from "@/lib/languages";
import { cn } from "@/lib/utils";
import type { Video } from "@/types/video";

/**
 * "Auto-detect → Hindi", from the labels the API serves for each code; a
 * video made in a language no longer offered (v1.0.11) still reads "Tamil".
 */
export function useLanguagePair(video: Video): { spoken: string; caption: string } | null {
  const { data } = useLanguageOptions();
  if (!data) return null;
  const spoken = languageName(video.spoken_language, data);
  const caption = video.caption_language === "same" ? "Same language" : languageName(video.caption_language, data);
  return { spoken, caption };
}

/**
 * One video in the grid (v1.1.0): a rounded 16:9 thumbnail, the title, and
 * one grey line ("Hindi · 0:36 · Ready"), with nothing around them. Its
 * actions are behind "…", shown on hover or focus (always on touch).
 * Processing draws a thin progress bar along the thumbnail's foot; failed is
 * a red dot and "Failed".
 */
export function VideoCard({ video }: { video: Video }) {
  const meta = useVideoMeta(video);
  const working = video.status === "processing" || video.status === "pending";
  const failed = video.status === "failed";

  return (
    <article className="group flex min-w-0 flex-col gap-2.5">
      <Link
        href={`/editor/${video.id}`}
        tabIndex={-1}
        aria-hidden="true"
        className="relative block aspect-video w-full overflow-hidden rounded-xl bg-surface-2"
      >
        {video.has_thumbnail ? (
          <AuthedImage
            path={`/api/videos/${video.id}/thumbnail`}
            alt=""
            className={cn(
              "size-full object-cover transition-opacity duration-200 ease-out group-hover:opacity-90",
              working && "opacity-60"
            )}
            fallback={<Film className="m-auto size-6 text-muted-foreground" />}
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <Film className="size-6 text-muted-foreground" />
          </span>
        )}

        {working && (
          <span className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
            <span
              className="block h-full bg-accent transition-[width] duration-500 ease-out"
              style={{ width: `${video.status === "processing" ? video.progress : 0}%` }}
            />
          </span>
        )}
      </Link>

      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold leading-[22px]" title={video.title}>
            <Link href={`/editor/${video.id}`} className="rounded-sm hover:underline hover:underline-offset-2">
              {video.title}
            </Link>
          </h3>
          <p
            className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted-foreground"
            title={failed && video.error_message ? video.error_message : undefined}
          >
            {failed && <span className="size-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />}
            <span className="truncate">{meta.join(" · ")}</span>
          </p>
        </div>
        <VideoActions
          video={video}
          className="-mr-2 -mt-1 shrink-0 opacity-0 transition-opacity duration-200 ease-out focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
        />
      </div>
    </article>
  );
}
