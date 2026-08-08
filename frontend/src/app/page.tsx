import Link from "next/link";
import { ArrowRight, Captions, Search, Sparkles, Wand2 } from "lucide-react";

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
      <header className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
        <Brand />
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        <section className="relative py-20 text-center sm:py-28">
          {/* A soft wash behind the headline rather than a hard gradient panel.
              aria-hidden and pointer-events-none: it is atmosphere, and must
              never intercept a click meant for the buttons. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 -z-10 mx-auto h-72 max-w-2xl bg-gradient-to-b from-primary/15 to-transparent blur-3xl"
          />

          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
            <Sparkles className="size-3 text-primary" />
            Local transcription · semantic search · grounded answers
          </span>

          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Captions for your video,
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              and a way back to any moment
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
            Upload a video, get an accurate transcript, edit and style the captions,
            then search your whole library by what was actually said.
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/register" className={buttonVariants({ size: "lg" })}>
              Get started
              <ArrowRight />
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              Sign in
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-24 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-border bg-card p-5 shadow-sm"
            >
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <feature.icon className="size-[18px]" />
              </span>
              <h2 className="mt-4 text-sm font-semibold">{feature.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
