import type { NextConfig } from "next";

const allowedDevOrigins = process.env.NEXT_ALLOWED_DEV_ORIGINS?.split(",").filter(Boolean);

export default {
  allowedDevOrigins,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@browser-ui/core", "@browser-ui/react"],
  typedRoutes: true,
} satisfies NextConfig;
