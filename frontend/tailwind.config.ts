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
    // Accent, red and orange text read their own AA tokens while the fills,
    // dots and rings keep the brief's exact colours (see globals.css).
    // A function over the whole palette, not `extend.textColor`: extended
    // colours are merged in after it and would win back these names.
    textColor: ({ theme }) => ({
      ...theme("colors"),
      primary: {
        DEFAULT: withAlpha("--primary-text"),
        foreground: withAlpha("--primary-foreground"),
        muted: withAlpha("--primary-muted"),
      },
      destructive: {
        DEFAULT: withAlpha("--destructive-text"),
        foreground: withAlpha("--destructive-foreground"),
      },
      warning: withAlpha("--warning-text"),
    }),
    // The type scale (DESIGN_SYSTEM.md): caption 12/16, secondary 13/18, body
    // 15/22, section title 20/25, page title 28/34. Tailwind's own names are
    // remapped so every screen moves to the scale at once; px, not rem, so a
    // browser font setting can't break the timeline's labels.
    fontSize: {
      "2xs": ["11px", { lineHeight: "14px" }],
      xs: ["12px", { lineHeight: "16px" }],
      sm: ["13px", { lineHeight: "18px" }],
      base: ["15px", { lineHeight: "22px" }],
      lg: ["17px", { lineHeight: "22px" }],
      xl: ["20px", { lineHeight: "25px", letterSpacing: "-0.02em" }],
      "2xl": ["28px", { lineHeight: "34px", letterSpacing: "-0.02em" }],
      "3xl": ["34px", { lineHeight: "41px", letterSpacing: "-0.02em" }],
      "4xl": ["40px", { lineHeight: "48px", letterSpacing: "-0.02em" }],
      "5xl": ["48px", { lineHeight: "56px", letterSpacing: "-0.02em" }],
      "6xl": ["60px", { lineHeight: "68px", letterSpacing: "-0.02em" }],
      title: ["28px", { lineHeight: "34px", letterSpacing: "-0.02em", fontWeight: "600" }],
      section: ["20px", { lineHeight: "25px", letterSpacing: "-0.02em", fontWeight: "600" }],
      body: ["15px", { lineHeight: "22px" }],
      secondary: ["13px", { lineHeight: "18px" }],
      caption: ["12px", { lineHeight: "16px" }],
      // Older names, kept so screens not yet restyled read on the new scale.
      h1: ["28px", { lineHeight: "34px", letterSpacing: "-0.02em", fontWeight: "600" }],
      h2: ["20px", { lineHeight: "25px", letterSpacing: "-0.02em", fontWeight: "600" }],
      "body-md": ["15px", { lineHeight: "22px" }],
      "body-sm": ["13px", { lineHeight: "18px" }],
      "label-caps": ["13px", { lineHeight: "18px" }],
      "mono-data": ["13px", { lineHeight: "18px", fontWeight: "500" }],
      "mono-data-sm": ["12px", { lineHeight: "16px" }],
    },
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
        segment: withAlpha("--segment"),
        success: withAlpha("--success"),
        warning: withAlpha("--warning"),
        destructive: {
          DEFAULT: withAlpha("--destructive"),
          foreground: withAlpha("--destructive-foreground"),
          fill: withAlpha("--destructive-fill"),
        },
      },
      // Segmented controls 8px (md), buttons and inputs 10px (lg), thumbnails
      // and the video 12px (xl), dialogs 16px (2xl).
      borderRadius: {
        sm: "6px",
        md: "8px",
        lg: "var(--radius)",
        xl: "12px",
        "2xl": "16px",
      },
      // The header height, subtracted in calc() by the editor's layout.
      spacing: {
        header: "52px",
      },
      boxShadow: {
        // Named for intent, not for size, so a component asks for the
        // elevation it means and both themes answer appropriately.
        sm: "var(--shadow-sm)",
        card: "var(--shadow-md)",
        overlay: "var(--shadow-lg)",
      },
      // The system's own face; monospace only for timestamps and timecodes.
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          "Inter",
          "sans-serif",
        ],
        mono: ["ui-monospace", '"SF Mono"', '"Cascadia Mono"', "Menlo", "Consolas", "monospace"],
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
        "fade-in": "fade-in 200ms ease-out",
        "fade-up": "fade-up 220ms ease-out",
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
