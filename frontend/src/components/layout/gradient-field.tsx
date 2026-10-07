/**
 * The blurred gradient field the glass surfaces refract.
 *
 * The 21st.dev original referenced `var(--color-primary)`, `--color-secondary`
 * and `--color-chart-1` through `--color-chart-5`. Two problems with that
 * here: the `--color-*` prefix is Tailwind v4's token naming and this project
 * is on v3, and there are no chart tokens at all. Every `stop-color` would
 * have resolved to nothing and the whole field would have rendered black.
 *
 * So it is rebuilt on the tokens that exist. The palette is deliberately
 * narrow — primary, accent, and one warm note — rather than the original's
 * five-way spread including `--destructive`. A red wash behind a sign-up form
 * reads as an error before anyone has done anything wrong.
 *
 * Server component: it is inert SVG, so there is no reason to ship it to the
 * browser as JavaScript.
 *
 * Shared by the auth screens and the dashboard, which is the point of it
 * living here rather than under components/auth. Glass has nothing to refract
 * on a flat background — it reads as a grey box — so anywhere .glass-surface
 * appears, this has to be behind it. Cloning the effect for a second screen is
 * how the two drift apart; `className` lets a caller dial the intensity
 * instead, which is the only thing that legitimately differs. The auth screens
 * are a single centred card and can carry a loud field; a dashboard is read
 * for hours and cannot.
 */
export function GradientField({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 800 600"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={["absolute inset-0 size-full", className].filter(Boolean).join(" ")}
    >
      <defs>
        <linearGradient id="auth-violet" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.8" />
          <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="auth-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity="0.75" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id="auth-warm" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity="0.45" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
        </radialGradient>

        {/* Large stdDeviation is the whole effect — these are shapes only in
            the sense that a blurred shape is a soft light source. */}
        <filter id="auth-blur-lg" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="45" />
        </filter>
        <filter id="auth-blur-md" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="35" />
        </filter>
        <filter id="auth-blur-sm" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="25" />
        </filter>
      </defs>

      {/* The drift is two slow counter-moving groups. Both animations are
          declared in the Tailwind config, so the global reduced-motion reset
          reaches them — the original declared them in an inline <style> tag,
          where they were global CSS with none of the app's guards applied. */}
      <g className="animate-drift-a">
        <ellipse
          cx="200"
          cy="500"
          rx="250"
          ry="180"
          fill="url(#auth-violet)"
          filter="url(#auth-blur-md)"
          transform="rotate(-30 200 500)"
        />
        <rect
          x="500"
          y="100"
          width="300"
          height="250"
          rx="80"
          fill="url(#auth-cyan)"
          filter="url(#auth-blur-sm)"
          transform="rotate(15 650 225)"
        />
      </g>

      <g className="animate-drift-b">
        <circle
          cx="650"
          cy="450"
          r="150"
          fill="url(#auth-warm)"
          filter="url(#auth-blur-lg)"
          opacity="0.7"
        />
        <ellipse
          cx="50"
          cy="150"
          rx="180"
          ry="120"
          fill="hsl(var(--accent))"
          filter="url(#auth-blur-sm)"
          opacity="0.6"
        />
      </g>
    </svg>
  );
}
