import { FileQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/layout/brand";
import { buttonVariants } from "@/components/ui/button-variants";

export const metadata: Metadata = { title: "Page not found · VideoCaptionMaker" };

/**
 * Any URL that matches no route at all: a mistyped address, an old bookmark.
 *
 * (dashboard)/not-found.tsx covers `notFound()` inside the dashboard, where the
 * header is already on screen. This one renders without it, so it carries the
 * wordmark itself and a single way back.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-header items-center border-b border-border px-4 sm:px-8">
        <Brand href="/dashboard" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <FileQuestion className="mb-4 size-8 text-muted-foreground" aria-hidden="true" />
        <p className="label-caps">Error 404</p>
        <h1 className="mt-1 text-2xl font-semibold">Page not found</h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          This address doesn&apos;t match any page in VideoCaptionMaker. Your
          videos are where you left them.
        </p>
        <Link href="/dashboard" className={`mt-6 ${buttonVariants()}`}>
          Back to your videos
        </Link>
      </main>
    </div>
  );
}
