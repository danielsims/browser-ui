import type { NextConfig } from "next";

const allowedDevOrigins = [
  "localhost",
  "127.0.0.1",
  ...(process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",").filter(Boolean) ?? []),
];

export default {
  allowedDevOrigins,
  devIndicators: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@browser-ui/core", "@browser-ui/react"],
} satisfies NextConfig;
