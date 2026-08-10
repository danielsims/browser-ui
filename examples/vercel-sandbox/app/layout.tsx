import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "@browser-ui/react/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "browser-ui / vercel-sandbox",
  description: "A remote agent-browser session running in Vercel Sandbox.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
