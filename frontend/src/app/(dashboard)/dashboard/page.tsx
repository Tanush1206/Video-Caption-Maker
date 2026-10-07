import Link from "next/link";
import { Search } from "lucide-react";

import { StatsStrip } from "@/components/dashboard/stats-strip";
import { GradientField } from "@/components/layout/gradient-field";
import { CONTAINER } from "@/components/layout/page-frame";
import { buttonVariants } from "@/components/ui/button-variants";
import { VideoLibrary } from "@/components/videos/video-library";
import { VideoUpload } from "@/components/videos/video-upload";
import { cn } from "@/lib/utils";

/**
 * Two panes of glass over a gradient, rather than hairlines on white.
 *
 * The previous version was rules and rhythm — no fills, no panels — and the
 * reasoning behind that still holds for the *contents*: the figures are not
 * four things to act on, and a grid of equal cards throws away the fact that
 * these videos have different lengths. None of that has changed. What changed
 * is the level the framing happens at. One panel around the whole workbench
 * says "this is where you put things in"; four cards around four numbers said
 * each number was a destination.
 *
 * The field is fixed rather than absolute, so it does not scroll away and
 * leave the lower panel refracting plain background. That is the only way
 * glass reads as glass on a page taller than the viewport.
 */
export default function DashboardPage() {
  return (
    <main className={cn(CONTAINER, "relative py-6 sm:py-8")}>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10">
        {/* Quieter than the auth screens by design. That is a sign-in page
            looked at for eight seconds; this is looked at for an afternoon. */}
        <GradientField className="opacity-80" />
        {/* The scrim is not optional. Without it the bright regions take
            enough contrast out of body text to fail on both themes, and the
            backdrop is decoration — it has to stay behind the reading. */}
        <div className="absolute inset-0 bg-background/[0.78] backdrop-blur-[2px]" />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {/* text-h1, not text-2xl. Same 24px, but via the scale the rest of
              the app uses, so a change to it reaches here too. */}
          <h1 className="text-h1">Your videos</h1>
          <p className="mt-1 text-body-md text-muted-foreground">
            Upload a video, pick a language, export it with captions.
          </p>
        </div>

        <Link href="/search" className={buttonVariants({ variant: "secondary" })}>
          <Search />
          Search everything
        </Link>
      </div>

      <div className="mt-6 space-y-5">
        {/* The job this app exists for comes first: Upload → Language →
            Export. Everything else on the page is about what is already here. */}
        <section className="glass-surface glass-rect p-4 sm:p-5">
          <VideoUpload />
        </section>

        <section className="glass-surface glass-rect p-4 sm:p-5">
          <StatsStrip />
          <div className="mt-4 border-t border-border/60 pt-4">
            <VideoLibrary />
          </div>
        </section>
      </div>
    </main>
  );
}
