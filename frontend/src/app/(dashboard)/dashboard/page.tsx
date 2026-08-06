import { VideoGrid } from "@/components/videos/video-grid";
import { VideoUpload } from "@/components/videos/video-upload";

export default function DashboardPage() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold">Your videos</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Upload a video to transcribe, caption, and search it.
      </p>

      <div className="mt-6">
        <VideoUpload />
      </div>

      <div className="mt-8">
        {/* Milestone 10: filters, sorting, and storage usage land here. */}
        <VideoGrid />
      </div>
    </main>
  );
}
