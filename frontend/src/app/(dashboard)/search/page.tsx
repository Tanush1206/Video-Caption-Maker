"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { SearchWorkspace } from "@/components/search/search-workspace";

/** Search across everything the signed-in user owns. */
export default function LibrarySearchPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/dashboard"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to your videos
      </Link>

      <SearchWorkspace
        videoId={null}
        heading="Search everything"
        subheading="Searches every transcript by meaning, not by keyword — the words you type don't have to appear in the video."
      />
    </main>
  );
}
