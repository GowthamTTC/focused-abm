import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Focused ABM",
  description: "LinkedIn 1st-degree connections → ranked ABM batches",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
