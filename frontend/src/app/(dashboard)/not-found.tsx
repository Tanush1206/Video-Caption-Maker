import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";

export default function DashboardNotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <span className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="size-5" />
      </span>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        That link doesn&apos;t point anywhere. It may have been a video that has
        since been deleted.
      </p>
      <Link href="/dashboard" className={`mt-6 ${buttonVariants()}`}>
        Back to your videos
      </Link>
    </main>
  );
}
