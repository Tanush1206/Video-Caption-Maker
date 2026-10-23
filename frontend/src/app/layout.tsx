import type { Metadata } from "next";
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

// No webfont for the interface (v1.1.0): the system's own face, and the
// system's monospace for timecodes (tailwind.config.ts fontFamily). The
// caption faces are separate, in public/fonts, and unchanged.

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
      <body className="font-sans">
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
