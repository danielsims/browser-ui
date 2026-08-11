import { defineConfig } from "eslint/config";

import { baseConfig } from "@browser-ui/eslint-config/base";
import { reactConfig } from "@browser-ui/eslint-config/react";

export default defineConfig(
  { ignores: [".expo/**", "expo-env.d.ts"] },
  baseConfig,
  reactConfig,
);
