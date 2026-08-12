import Link from "next/link";

import { Hero } from "@/components/landing/hero";
import { Brand } from "@/components/layout/brand";
import { CONTAINER, PageHeader } from "@/components/layout/page-frame";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { buttonVariants } from "@/components/ui/button-variants";
import { FEATURES } from "@/lib/features";
import { cn } from "@/lib/utils";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
      {/* Transparent and overlapping the hero, so the backdrop's glow runs up
          behind it rather than stopping at a seam under the header. Same
          frame as the signed-in header, so the brand mark doesn't move when
          you sign in. */}
      <PageHeader className="relative">
        <Brand />
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            Sign in
          </Link>
        </div>
      </PageHeader>

      <main>
        <Hero />

        <section className={cn(CONTAINER, "grid gap-3 pb-24 sm:grid-cols-3")}>
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
