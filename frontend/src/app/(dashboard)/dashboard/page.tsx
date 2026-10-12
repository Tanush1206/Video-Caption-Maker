import { StatsStrip } from "@/components/dashboard/stats-strip";
import { WIDE_CONTAINER } from "@/components/layout/page-frame";
import { VideoLibrary } from "@/components/videos/video-library";
import { VideoUpload } from "@/components/videos/video-upload";
import { cn } from "@/lib/utils";

/**
 * Projects: the Upload → Language → Export flow on top, everything already
 * here underneath. Flat panels on the canvas (DESIGN.md: hairline borders and
 * tonal steps, no glass, no gradients behind the content).
 */
export default function DashboardPage() {
  return (
    <main className={cn(WIDE_CONTAINER, "flex flex-col gap-6 py-6")}>
      <h1 className="sr-only">Your projects</h1>

      <section aria-label="Caption a video">
        <VideoUpload />
      </section>

      <section aria-label="Your projects" className="flex flex-col gap-4">
        <StatsStrip />
        <VideoLibrary />
      </section>
    </main>
  );
}
