import { AuthBackdrop } from "@/components/auth/auth-backdrop";
import { Brand } from "@/components/layout/brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";

/**
 * The frame shared by sign-in and registration.
 *
 * The gradient field lives here rather than on the sign-up page it came with.
 * Both screens use the same glass controls, and glass needs something behind
 * it to refract — on a flat background the effect reads as a grey box. Putting
 * it in the layout is also what stops the two screens drifting apart again,
 * which is why this file exists at all.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
        <AuthBackdrop />
        {/* A scrim over the gradient. Without it the light areas take enough
            contrast out of the body text to fail on both themes — the
            backdrop is decoration and has to stay behind the reading. */}
        <div className="absolute inset-0 bg-background/75 backdrop-blur-[2px]" />
      </div>

      <header className="flex items-center justify-between px-6 py-5">
        <Brand />
        <ThemeToggle />
      </header>

      <main className="flex flex-1 items-center justify-center px-6 pb-20">
        <div className="w-full max-w-md animate-fade-up">{children}</div>
      </main>
    </div>
  );
}
