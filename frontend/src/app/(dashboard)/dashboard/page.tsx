import { WIDE_CONTAINER } from "@/components/layout/page-frame";
import { VideoLibrary } from "@/components/videos/video-library";
import { VideoUpload } from "@/components/videos/video-upload";
import { cn } from "@/lib/utils";

/**
 * Videos: a calm upload area on top (the Upload → Language → Export flow
 * starts there), then the library. Sections 48 px apart; no panels, no
 * gradient behind the content (v1.1.0).
 */
export default function DashboardPage() {
  return (
    <main className={cn(WIDE_CONTAINER, "flex flex-col gap-12 py-8")}>
      <h1 className="sr-only">Your videos</h1>

      <section aria-label="Caption a video">
        <VideoUpload />
      </section>

      <section aria-label="Your videos">
        <VideoLibrary />
      </section>
    </main>
  );
}
