import Link from "next/link";
import { Search } from "lucide-react";

import { StatsBar } from "@/components/dashboard/stats-bar";
import { VideoGrid } from "@/components/videos/video-grid";
import { VideoUpload } from "@/components/videos/video-upload";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Your videos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a video to transcribe, caption, and search it.
          </p>
        </div>

        <Link
          href="/search"
          className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-muted"
        >
          <Search className="h-4 w-4" />
          Search everything
        </Link>
      </div>

      <div className="mt-6">
        <StatsBar />
      </div>

      <div className="mt-6">
        <VideoUpload />
      </div>

      <div className="mt-8">
        <VideoGrid />
      </div>
    </main>
  );
}
