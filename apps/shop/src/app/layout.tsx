import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import "./styles.css";
import "@browser-ui/react/styles.css";

export const metadata: Metadata = {
  title: "Mise — shop a recipe live",
  description:
    "Type a dish and watch an on-device agent shop the ingredients in a real Woolworths session you can take over.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
