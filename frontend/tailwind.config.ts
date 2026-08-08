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
      borderRadius: {
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 5px)",
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
      },
      animation: {
        "fade-in": "fade-in 180ms ease-out",
        "fade-up": "fade-up 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        shimmer: "shimmer 1.6s infinite",
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
