import Link from "next/link";
import { Captions, Search, Wand2 } from "lucide-react";

import { Hero } from "@/components/landing/hero";
import { Brand } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { buttonVariants } from "@/components/ui/button-variants";

const FEATURES = [
  {
    icon: Wand2,
    title: "Transcribed on your own GPU",
    body: "Whisper runs locally. Your video never leaves the machine, and there is no per-minute bill.",
  },
  {
    icon: Captions,
    title: "An editor, not a text box",
    body: "Waveform timeline, drag the boundaries, restyle the captions, and burn them in — or export SRT.",
  },
  {
    icon: Search,
    title: "Search by meaning",
    body: "Find the moment you half-remember. The words you type don't have to appear in the transcript.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Transparent and overlapping the hero, so the backdrop's glow runs up
          behind it rather than stopping at a seam under the header. */}
      <header className="relative z-20 mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </header>

      <main>
        <Hero />

        <section className="mx-auto grid max-w-6xl gap-3 px-6 pb-24 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="group relative overflow-hidden rounded-xl border border-border bg-surface-1 p-6 transition-colors hover:bg-card"
            >
              {/* A wash that fades in from the icon's corner. Cheap, and it
                  makes a static card feel like it responds to the pointer. */}
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.06] to-transparent opacity-0 transition-opacity group-hover:opacity-100"
              />
              <span className="relative flex size-12 items-center justify-center rounded-lg border border-border bg-card text-primary transition-colors group-hover:border-primary/50">
                <feature.icon className="size-5" />
              </span>
              <h2 className="relative mt-6 text-h2">{feature.title}</h2>
              <p className="relative mt-2 text-body-sm leading-relaxed text-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
