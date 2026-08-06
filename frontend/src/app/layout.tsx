import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthBootstrap } from "@/components/layout/auth-bootstrap";
import { Providers } from "@/components/layout/providers";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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

const inter = Inter({ subsets: ["latin"] });

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
      <body className={inter.className}>
        <ThemeProvider>
          <ThemeToggle />
          <Providers>
            {/* Silently restores the session from the refresh cookie on load. */}
            <AuthBootstrap />
            {children}
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
