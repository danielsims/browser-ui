import { defineConfig } from "eslint/config";

import { baseConfig } from "@browser-ui/eslint-config/base";

export default defineConfig({ ignores: ["dist/**", "test/**"] }, baseConfig);
