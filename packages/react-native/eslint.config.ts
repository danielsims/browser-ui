import { defineConfig } from "eslint/config";

import { baseConfig } from "@browser-ui/eslint-config/base";
import { reactConfig } from "@browser-ui/eslint-config/react";

export default defineConfig({ ignores: ["dist/**"] }, baseConfig, reactConfig);
