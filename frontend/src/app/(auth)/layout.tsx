import { Brand } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * The frame shared by sign-in and registration.
 *
 * Exists mostly so the theme toggle has somewhere to live now that it is no
 * longer fixed to the viewport corner, but it also stops the two forms from
 * drifting apart: they were already disagreeing about heading size and spacing.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-64 bg-gradient-to-b from-primary/10 to-transparent blur-2xl"
      />

      <header className="flex items-center justify-between px-6 py-5">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-20">
        <div className="w-full max-w-sm animate-fade-up">{children}</div>
      </main>
    </div>
  );
}
