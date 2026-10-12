import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";
import { AuthBootstrap } from "@/components/layout/auth-bootstrap";
import { Providers } from "@/components/layout/providers";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ScrollActivity } from "@/components/scroll-activity";
import { THEME_STORAGE_KEY } from "@/lib/theme";

// Runs before first paint, so the correct theme is applied without a flash
// of the wrong one. Falls back to the OS preference when nothing is stored.
const themeInitScript = `
(function() {
  try {
    var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
    var dark = stored
      ? stored === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

// Exposed as CSS variables rather than class names so Tailwind's fontFamily
// can reference them, and so a `font-mono` utility anywhere picks the right
// face without the component knowing which font is loaded.
// Geist, DESIGN.md's UI face. Next 14's Google list predates it, so the
// variable file is bundled here (from the `geist` npm package, OFL; licence
// alongside). Not in public/fonts: that folder is the caption fonts, which
// the backend image copies for burn-in.
const sans = localFont({
  src: "./fonts/Geist-Variable.woff2",
  variable: "--font-sans",
  weight: "100 900",
  display: "swap",
});

// Timecodes, byte counts and progress percentages sit in columns that must not
// jitter as their digits change. A proportional face makes 00:11 narrower than
// 00:00, and the whole row shifts every tenth of a second during playback.
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VideoCaptionMaker — AI Captions & Transcript Search",
  description:
    "Upload videos, get AI-generated captions, and search across your video library by meaning, not just keywords.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${sans.variable} ${mono.variable} font-sans`}>
        <ThemeProvider>
          <Providers>
            {/* Silently restores the session from the refresh cookie on load. */}
            <AuthBootstrap />
            {/* Flags the element being scrolled, so scrollbars can stay hidden
                until they are actually in use. Renders nothing. */}
            <ScrollActivity />
            {children}
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
