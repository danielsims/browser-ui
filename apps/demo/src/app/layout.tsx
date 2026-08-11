import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./styles.css";
import "@browser-ui/react/styles.css";

export const metadata: Metadata = {
  title: "browser-ui",
  description:
    "A composable React viewport for agent-browser. Stream a real session, visualize agent actions and hand control to a person without changing transports.",
  metadataBase: new URL("https://browser-ui-red.vercel.app"),
  openGraph: {
    title: "browser-ui",
    description:
      "A composable React viewport for agent-browser. Stream a real session, visualize agent actions and hand control to a person without changing transports.",
    url: "https://browser-ui-red.vercel.app",
    type: "website",
    images: ["/api/og"],
  },
  twitter: {
    card: "summary_large_image",
    title: "browser-ui",
    description:
      "A composable React viewport for agent-browser. Stream a real session, visualize agent actions and hand control to a person without changing transports.",
    images: ["/api/og"],
  },
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
