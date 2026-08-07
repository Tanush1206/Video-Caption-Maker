"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { CaptionEditor } from "@/components/captions/caption-editor";
import { useVideo } from "@/hooks/use-videos";
import { formatDuration } from "@/lib/format";

export default function EditorPage({ params }: { params: { id: string } }) {
  const videoId = Number(params.id);
  const { data: video, isLoading, isError } = useVideo(videoId);

  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-sm text-muted-foreground">Invalid video id.</p>;
  }

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </main>
    );
  }

  if (isError || !video) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-8">
        <p role="alert" className="rounded-md bg-red-500/10 px-4 py-3 text-sm text-red-500">
          Couldn&apos;t load this video. It may have been deleted.
        </p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-primary hover:underline">
          Back to your videos
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <Link
        href="/dashboard"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your videos
      </Link>

      <h1 className="text-2xl font-semibold">{video.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {formatDuration(video.duration_ms)}
        {video.status !== "completed" && ` · ${video.status}`}
      </p>

      {/* Milestone 6 adds the player and timeline alongside this list. */}
      <div className="mt-8">
        <CaptionEditor video={video} />
      </div>
    </main>
  );
}
