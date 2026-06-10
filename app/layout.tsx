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
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <div className="brand">
            <span className="dot" />
            REEL STUDIO
          </div>
          <div className="links">
            <a href="#workflow">WHAT WE DO</a>
            <a href="#script">SCRIPT</a>
            <a href="#render">RENDER</a>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
