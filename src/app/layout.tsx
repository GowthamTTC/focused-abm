import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

/** Self-hosted fonts — no runtime or build-time dependency on Google's CDN.
 *  Variable files cover the weight ranges; Railway builds and local dev both
 *  work on any network, filtered or not. */
const display = localFont({
  src: "../fonts/bricolage-grotesque.woff2",
  weight: "500 700",
  variable: "--font-display",
  display: "swap",
});
const body = localFont({
  src: "../fonts/ibm-plex-sans.woff2",
  weight: "400 600",
  variable: "--font-body",
  display: "swap",
});
const mono = localFont({
  src: [
    { path: "../fonts/ibm-plex-mono-400.woff2", weight: "400" },
    { path: "../fonts/ibm-plex-mono-500.woff2", weight: "500" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Focused ABM",
  description: "LinkedIn 1st-degree connections → ranked ABM batches",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
