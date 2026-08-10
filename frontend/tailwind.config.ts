import type { Config } from "tailwindcss";

/**
 * Colours are wired as `hsl(var(--x) / <alpha-value>)` rather than
 * `hsl(var(--x))`. The placeholder is what lets opacity modifiers work, so
 * `bg-primary/10` and `ring-ring/60` resolve instead of silently doing
 * nothing — which is why the tokens store bare channels.
 */
const withAlpha = (token: string) => `hsl(var(${token}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: withAlpha("--border"),
        input: withAlpha("--input"),
        ring: withAlpha("--ring"),
        background: withAlpha("--background"),
        foreground: withAlpha("--foreground"),
        subtle: withAlpha("--subtle"),
        card: {
          DEFAULT: withAlpha("--card"),
          foreground: withAlpha("--card-foreground"),
        },
        // Elevation levels from the Stitch palette. Numbered rather than
        // named after a use, so a panel can ask for depth without claiming
        // what it is.
        surface: {
          1: withAlpha("--surface-1"),
          2: withAlpha("--surface-2"),
          3: withAlpha("--surface-3"),
        },
        primary: {
          DEFAULT: withAlpha("--primary"),
          foreground: withAlpha("--primary-foreground"),
          muted: withAlpha("--primary-muted"),
        },
        muted: {
          DEFAULT: withAlpha("--muted"),
          foreground: withAlpha("--muted-foreground"),
        },
        accent: withAlpha("--accent"),
        success: withAlpha("--success"),
        warning: withAlpha("--warning"),
        destructive: {
          DEFAULT: withAlpha("--destructive"),
          foreground: withAlpha("--destructive-foreground"),
        },
      },
      // Stitch's ramp: 4 / 8 / 12. Tighter than before and consistent across
      // the app, which is most of what makes it read as an instrument rather
      // than a consumer app.
      borderRadius: {
        xl: "calc(var(--radius) * 3)",
        lg: "calc(var(--radius) * 2)",
        md: "var(--radius)",
        sm: "calc(var(--radius) / 2)",
      },
      // The Stitch type scale. Sizes are fixed px rather than rem: this is a
      // dense tool where an 11px label must stay 11px, and a user's browser
      // font setting scaling the timeline labels would break the layout.
      fontSize: {
        h1: ["24px", { lineHeight: "32px", letterSpacing: "-0.02em", fontWeight: "600" }],
        h2: ["20px", { lineHeight: "28px", letterSpacing: "-0.01em", fontWeight: "600" }],
        "body-md": ["14px", { lineHeight: "20px" }],
        "body-sm": ["12px", { lineHeight: "16px" }],
        "label-caps": ["11px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "700" }],
        "mono-data": ["13px", { lineHeight: "16px", fontWeight: "500" }],
        "mono-data-sm": ["11px", { lineHeight: "14px" }],
      },
      // Only the header height is taken from Stitch's spacing scale. Its
      // other names (standard/compact/gutter) just restate Tailwind's numeric
      // scale under new words, and its `layout-sidebar` was applied as
      // horizontal page padding - a 280px gutter, which is a bug not a token.
      // This one earns a name because layouts subtract it in calc().
      spacing: {
        header: "56px",
      },
      boxShadow: {
        // Named for intent, not for size, so a component asks for the
        // elevation it means and both themes answer appropriately.
        sm: "var(--shadow-sm)",
        card: "var(--shadow-md)",
        overlay: "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // A sweep across a placeholder reads as "loading" far better than a
        // pulse, which looks like something is wrong with the page.
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        // Longer travel than fade-up, for the landing page's staggered entrance.
        // In-app motion should be quick and unnoticed; a first impression can
        // afford to be seen.
        "fade-slide-in": {
          from: { opacity: "0", transform: "translateY(20px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        // Exactly -50%, which is only seamless because the marquee track holds
        // two identical copies and spaces them with padding on each item rather
        // than `gap`. A flex `gap` adds one extra space *between* the copies
        // that isn't part of either, so -50% lands half a gap short and the
        // loop visibly hitches once per cycle.
        marquee: {
          from: { transform: "translateX(0)" },
          to: { transform: "translateX(-50%)" },
        },
        // The two counter-drifting groups in the auth backdrop. Small offsets
        // over a long period: the point is that the light behind the form is
        // never quite still, not that anything is seen to move.
        "drift-a": {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(-10px, 10px)" },
        },
        "drift-b": {
          "0%, 100%": { transform: "translate(0, 0)" },
          "50%": { transform: "translate(10px, -10px)" },
        },
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        "fade-up": "fade-up 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        shimmer: "shimmer 1.6s infinite",
        // `both`, so the from-state applies during the delay too. The usual
        // version of this pattern sets `opacity: 0` in a separate rule and
        // fills forwards, which leaves the content permanently invisible if
        // the animation never runs. Backwards fill needs no such rule.
        "fade-slide-in": "fade-slide-in 700ms cubic-bezier(0.22, 1, 0.36, 1) both",
        marquee: "marquee 40s linear infinite",
        "drift-a": "drift-a 20s ease-in-out infinite",
        "drift-b": "drift-b 25s ease-in-out infinite",
      },
      transitionTimingFunction: {
        // Decelerating: fast to start so it feels responsive, slow to settle
        // so it doesn't feel abrupt. Linear reads as mechanical.
        out: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
