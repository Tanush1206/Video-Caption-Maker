import { cn } from "@/lib/utils";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * A plain anchor, never a fetch: OAuth needs a full-page navigation so the
 * browser follows Google's redirect and receives the callback's cookie. An
 * XHR would hit CORS and never leave the page.
 *
 * The mark is inline SVG in Google's own brand colours, which their branding
 * terms require — a monochrome or recoloured "G" is not permitted, so this one
 * element deliberately ignores the theme.
 */
export function GoogleButton({ label }: { label: string }) {
  return (
    <a
      href={`${API_URL}/api/auth/google/authorize`}
      className={cn(
        "flex h-10 w-full items-center justify-center gap-2.5 rounded-md",
        "border border-border bg-card text-sm font-medium shadow-sm",
        "transition-colors hover:bg-muted"
      )}
    >
      <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
        <path
          fill="#4285F4"
          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
        />
        <path
          fill="#34A853"
          d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
        />
        <path
          fill="#FBBC05"
          d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
        />
        <path
          fill="#EA4335"
          d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14Z"
        />
      </svg>
      {label}
    </a>
  );
}

export function AuthDivider() {
  return (
    <div className="my-5 flex items-center gap-3">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground">or</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
