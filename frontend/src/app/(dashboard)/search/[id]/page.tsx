"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { WIDE_CONTAINER } from "@/components/layout/page-frame";
import { SearchWorkspace } from "@/components/search/search-workspace";
import { cn } from "@/lib/utils";
import { useVideo } from "@/hooks/use-videos";

export default function VideoSearchPage({ params }: { params: { id: string } }) {
  const videoId = Number(params.id);

  if (Number.isNaN(videoId)) {
    return <p className="p-8 text-[15px] text-muted-foreground">Invalid video id.</p>;
  }

  return <VideoSearch videoId={videoId} />;
}

function VideoSearch({ videoId }: { videoId: number }) {
  const { data: video } = useVideo(videoId);

  return (
    <main className={cn(WIDE_CONTAINER, "py-8")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link
          href={`/editor/${videoId}`}
          className="-ml-1 inline-flex items-center gap-0.5 rounded-sm text-[15px] text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
          Back to the editor
        </Link>
        <Link href="/search" className="rounded-sm text-[15px] text-primary hover:underline">
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
