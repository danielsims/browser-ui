import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./styles.css";
import "@browser-ui/react/styles.css";

const siteUrl = new URL("https://browser-ui.danielsi.ms");
const title = "browser-ui";
const description =
  "A composable React viewport for agent-browser. Stream a real session, visualize agent actions and hand control to a person without changing transports.";
const socialImage = {
  url: "/api/og",
  width: 1200,
  height: 630,
  alt: "browser-ui — a composable React viewport for agent-browser",
};

export const metadata: Metadata = {
  title,
  description,
  metadataBase: siteUrl,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title,
    description,
    url: siteUrl,
    siteName: title,
    type: "website",
    images: [socialImage],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
