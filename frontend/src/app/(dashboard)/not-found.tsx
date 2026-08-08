import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function DashboardNotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
      <FileQuestion className="mb-4 h-10 w-10 text-muted-foreground" />
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That link doesn&apos;t point anywhere. It may have been a video that has
        since been deleted.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground transition hover:opacity-90"
      >
        Back to your videos
      </Link>
    </main>
  );
}
