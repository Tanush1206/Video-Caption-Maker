"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { WIDE_CONTAINER } from "@/components/layout/page-frame";
import { SearchWorkspace } from "@/components/search/search-workspace";
import { cn } from "@/lib/utils";
import { useVideo } from "@/hooks/use-videos";

export default function VideoSearchPage({ params }: { params: { id: string } }) {
  const videoId = Number(params.id);

  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-sm text-muted-foreground">Invalid video id.</p>;
  }

  return <VideoSearch videoId={videoId} />;
}

function VideoSearch({ videoId }: { videoId: number }) {
  const { data: video } = useVideo(videoId);

  return (
    <main className={cn(WIDE_CONTAINER, "py-6")}>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Link
          href={`/editor/${videoId}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the editor
        </Link>
        <Link href="/search" className="text-sm text-primary hover:underline">
          Search all videos instead
        </Link>
      </div>

      <SearchWorkspace
        videoId={videoId}
        heading={video?.title ?? "Search"}
        subheading="Searches by meaning, not by keyword: the words you type don't have to appear in the transcript."
      />
    </main>
  );
}
