"use client";

import { WIDE_CONTAINER } from "@/components/layout/page-frame";
import { SearchWorkspace } from "@/components/search/search-workspace";
import { cn } from "@/lib/utils";

/** Search across everything the signed-in user owns. */
export default function LibrarySearchPage() {
  return (
    <main className={cn(WIDE_CONTAINER, "py-6")}>
      <SearchWorkspace
        videoId={null}
        heading="Search everything"
        subheading="Searches every transcript by meaning, not by keyword: the words you type don't have to appear in the video."
      />
    </main>
  );
}
