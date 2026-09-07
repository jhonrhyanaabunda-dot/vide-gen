import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Reel Studio — Dealership Reel Generator",
  description:
    "Automatically build 30-second vertical Reels for car dealerships, rendered entirely in the browser.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The top bar lives in page.tsx: it reflects render-engine and key state, so
  // it needs the client state rather than being static chrome up here.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
