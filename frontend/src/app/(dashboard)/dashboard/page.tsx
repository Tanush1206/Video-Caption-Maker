import Link from "next/link";
import { Search } from "lucide-react";

import { StatsBar } from "@/components/dashboard/stats-bar";
import { buttonVariants } from "@/components/ui/button-variants";
import { VideoGrid } from "@/components/videos/video-grid";
import { VideoUpload } from "@/components/videos/video-upload";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your videos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a video to transcribe, caption, and search it.
          </p>
        </div>

        <Link href="/search" className={buttonVariants({ variant: "secondary" })}>
          <Search />
          Search everything
        </Link>
      </div>

      <div className="mt-6 space-y-6">
        <StatsBar />
        <VideoUpload />
        <VideoGrid />
      </div>
    </main>
  );
}
