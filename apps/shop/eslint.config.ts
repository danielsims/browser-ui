import { defineConfig } from "eslint/config";

import { baseConfig } from "@browser-ui/eslint-config/base";
import { nextjsConfig } from "@browser-ui/eslint-config/nextjs";
import { reactConfig } from "@browser-ui/eslint-config/react";

export default defineConfig(
  {
    ignores: [".next/**", ".next-dev-*/**", "next-env.d.ts"],
  },
  baseConfig,
  reactConfig,
  nextjsConfig,
);
