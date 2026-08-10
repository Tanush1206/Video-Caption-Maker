import Link from "next/link";
import {
  ArrowRight,
  AudioLines,
  Boxes,
  Cpu,
  Database,
  Film,
  Server,
  ShieldCheck,
  Triangle,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";

/**
 * The landing hero, adapted from a 21st.dev glassmorphism component.
 *
 * Three things changed on the way in, all of them deliberate:
 *
 * 1. **Colour.** The original is hardcoded to `bg-zinc-950` / `text-white` /
 *    `border-white/10`. This app has a light theme, where that renders white
 *    text on a white card. Everything here speaks in tokens instead, so the
 *    glass is `bg-card/70` and reads correctly in both.
 *
 * 2. **Content.** The original ships an agency pitch — "150+ Projects
 *    Delivered", "98% Client Satisfaction", a marquee of invented client
 *    logos. Those are claims, and this project has no clients to make them
 *    about. The layout is kept; every figure in it now states something true.
 *    The preview card depicts the editor, and the marquee names dependencies
 *    that are actually in pyproject.toml and docker-compose.yml.
 *
 * 3. **Motion.** The keyframes moved from an inline `<style>` tag into the
 *    Tailwind config. A `<style>` element inside a component is still global
 *    CSS — its `.delay-100` and `.animate-marquee` leak to every page, and
 *    `.delay-100` in particular shadows Tailwind's own transition-delay
 *    utility of that name.
 */

/** Two cards share the glass treatment; the string is long enough to name. */
const GLASS = cn(
  "relative overflow-hidden rounded-xl border border-border shadow-overlay",
  // /70 rather than /5: the original's near-transparent white only works on a
  // near-black page. A card tint that follows the theme survives both.
  "bg-card/70 backdrop-blur-xl"
);

/** Real dependencies, from pyproject.toml and docker-compose.yml. */
const STACK = [
  { name: "Whisper", icon: AudioLines },
  { name: "FFmpeg", icon: Film },
  { name: "FastAPI", icon: Server },
  { name: "Next.js", icon: Triangle },
  { name: "PostgreSQL", icon: Database },
  { name: "Chroma", icon: Boxes },
] as const;

/** The lines in the mocked-up editor panel. */
const PREVIEW_CAPTIONS = [
  { time: "00:12.480", text: "…so the transcript is searchable by meaning," },
  { time: "00:15.920", text: "not just by the words you happen to remember." },
] as const;

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden">
      <Backdrop />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pb-20 pt-16 lg:grid-cols-12 lg:gap-10 lg:pb-28 lg:pt-24">
        {/* ---------------------------------------------------------- left */}
        <div className="flex flex-col gap-7 lg:col-span-7">
          <div className="animate-fade-slide-in [animation-delay:60ms]">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 backdrop-blur-md">
              <Cpu className="size-3.5 text-primary" aria-hidden="true" />
              <span className="label-caps text-primary">
                Whisper runs on your own GPU
              </span>
            </span>
          </div>

          {/* No mask-image on the heading. The original fades its bottom edge
              to transparent, which clips descenders and washes out the one
              line on the page that has to be legible. */}
          <h1 className="animate-fade-slide-in text-balance text-5xl font-semibold leading-[1.05] tracking-tight [animation-delay:140ms] sm:text-6xl lg:text-7xl">
            Captions for your video,
            <br />
            <span className="bg-gradient-to-br from-primary to-accent bg-clip-text text-transparent">
              and a way back
            </span>
            <br />
            to any moment
          </h1>

          <p className="max-w-xl animate-fade-slide-in text-pretty text-lg leading-relaxed text-muted-foreground [animation-delay:220ms]">
            Upload a video, get an accurate transcript, edit and style the captions,
            then search your whole library by what was actually said.
          </p>

          <div className="flex animate-fade-slide-in flex-col gap-3 [animation-delay:300ms] sm:flex-row">
            {/* buttonVariants rather than bespoke buttons: the originals carry
                no focus-visible ring at all, and these inherit the one every
                other control in the app uses. */}
            <Link href="/register" className={cn(buttonVariants({ size: "lg" }), "group")}>
              Get started
              <ArrowRight className="transition-transform duration-200 ease-out group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className={buttonVariants({ variant: "secondary", size: "lg" })}
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* --------------------------------------------------------- right */}
        <div className="flex animate-fade-slide-in flex-col gap-5 [animation-delay:380ms] lg:col-span-5">
          <EditorPreviewCard />
          <StackCard />
        </div>
      </div>
    </section>
  );
}

/**
 * A CSS-only backdrop.
 *
 * The source component pulls a 3840px WebP from a stranger's Supabase bucket.
 * That hands every visitor's IP to a third party on a page whose entire pitch
 * is that your media stays on your own hardware — and it is a hard dependency
 * on a URL nobody here controls. A glow and a grid cost nothing and cannot
 * 404.
 */
function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute -top-40 left-1/2 h-[34rem] w-[64rem] -translate-x-1/2 rounded-full bg-primary/20 blur-3xl" />
      <div className="absolute -top-24 right-0 h-80 w-80 rounded-full bg-accent/15 blur-3xl" />
      <div
        className="absolute inset-0 opacity-[0.55] [background-image:linear-gradient(to_right,hsl(var(--border)/0.5)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.5)_1px,transparent_1px)] [background-size:56px_56px]"
        style={{
          maskImage: "radial-gradient(ellipse 70% 55% at 50% 0%, black, transparent)",
          WebkitMaskImage:
            "radial-gradient(ellipse 70% 55% at 50% 0%, black, transparent)",
        }}
      />
    </div>
  );
}

/** A depiction of the editor. Labelled as one, so no number here reads as a claim. */
function EditorPreviewCard() {
  return (
    <div className={cn(GLASS, "p-6")}>
      <div className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative">
        <p className="label-caps">Editor preview</p>

        <div className="mt-4 flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2 text-primary">
            <AudioLines className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-body-md font-medium">conference-talk.mp4</p>
            <p className="text-body-sm text-muted-foreground">18 min · 1080p</p>
          </div>
        </div>

        <div className="mt-6 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-body-sm text-muted-foreground">Transcribing</span>
            <span className="text-mono-data tabular-nums font-mono">68%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="bar-fill h-full w-[68%] rounded-full" />
          </div>
        </div>

        <div className="mt-5 space-y-1.5">
          {PREVIEW_CAPTIONS.map((caption) => (
            <div
              key={caption.time}
              className="flex gap-3 rounded-md border border-border/60 bg-subtle px-3 py-2"
            >
              <span className="text-mono-data-sm shrink-0 pt-0.5 font-mono tabular-nums text-muted-foreground">
                {caption.time}
              </span>
              <span className="text-body-sm leading-relaxed">{caption.text}</span>
            </div>
          ))}
        </div>

        {/* divide-x on exactly three children. The original interleaved two
            divider <div>s among three stats inside a `grid-cols-3`, which is
            five grid items — they wrap onto a second row and the columns stop
            lining up. */}
        <div className="mt-6 grid grid-cols-3 divide-x divide-border/70 border-t border-border/70 pt-5">
          {["SRT", "VTT", "MP4"].map((format) => (
            <div key={format} className="flex flex-col items-center gap-0.5">
              <span className="text-body-md font-semibold">{format}</span>
              <span className="label-caps">Export</span>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <Pill>
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-success" />
            </span>
            Transcribing
          </Pill>
          <Pill>
            <ShieldCheck className="size-3 text-primary" aria-hidden="true" />
            Local GPU
          </Pill>
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="label-caps inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 py-1">
      {children}
    </span>
  );
}

/** "Built on", not "trusted by" — these are dependencies, not customers. */
function StackCard() {
  return (
    <div className={cn(GLASS, "group py-6")}>
      <h2 className="label-caps mb-5 px-6">Built on</h2>

      <div
        className="relative flex overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent, black 12%, black 88%, transparent)",
        }}
      >
        {/* Two copies, spaced by padding on each item rather than a flex gap —
            see the `marquee` keyframe for why that distinction matters. The
            second copy is hidden from assistive tech so the list is announced
            once. */}
        <div className="flex w-max animate-marquee pl-6 group-hover:[animation-play-state:paused]">
          {[0, 1].map((copy) => (
            <div key={copy} className="flex" aria-hidden={copy === 1 || undefined}>
              {STACK.map((tool) => (
                <span
                  key={tool.name}
                  className="flex items-center gap-2 pr-12 text-muted-foreground transition-colors hover:text-foreground"
                >
                  <tool.icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap text-body-md font-semibold tracking-tight">
                    {tool.name}
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
