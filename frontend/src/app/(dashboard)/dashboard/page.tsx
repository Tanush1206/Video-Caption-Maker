import Link from "next/link";
import { Search } from "lucide-react";

import { StatsStrip } from "@/components/dashboard/stats-strip";
import { CONTAINER } from "@/components/layout/page-frame";
import { buttonVariants } from "@/components/ui/button-variants";
import { VideoLibrary } from "@/components/videos/video-library";
import { VideoUpload } from "@/components/videos/video-upload";
import { cn } from "@/lib/utils";

export default function DashboardPage() {
  return (
    <main className={cn(CONTAINER, "py-6 sm:py-8")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* text-h1, not text-2xl. Same 24px, but via the scale the rest of
              the app uses, so a change to it reaches here too. */}
          <h1 className="text-h1">Your videos</h1>
          <p className="mt-1 text-body-md text-muted-foreground">
            Upload a video to transcribe, caption, and search it.
          </p>
        </div>

        <Link href="/search" className={buttonVariants({ variant: "secondary" })}>
          <Search />
          Search everything
        </Link>
      </div>

      {/* Rules and rhythm rather than a stack of panels: the strip is bounded
          by hairlines, the dropzone is the only bordered thing on the page,
          and the library below is separated by its own rules. */}
      <div className="mt-6 space-y-5">
        <StatsStrip />
        <VideoUpload />
        <VideoLibrary />
      </div>
    </main>
  );
}
