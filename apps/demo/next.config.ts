import type { NextConfig } from "next";

export default {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@browser-ui/react"],
  typedRoutes: true,
} satisfies NextConfig;
