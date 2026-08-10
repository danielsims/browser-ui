import { writeFile } from "node:fs/promises";

import {
  operatingShaderFragmentSources,
  operatingShaderVariants,
} from "../dist/index.js";
import { flutterFragmentSource } from "./flutter-source.mjs";

const flutterShaders = new URL("../../flutter/shaders/", import.meta.url);

await Promise.all([
  ...operatingShaderVariants.map((variant) => writeFile(
    new URL(`operating_${variant}.frag`, flutterShaders),
    flutterFragmentSource(operatingShaderFragmentSources[variant]),
  )),
  // Preserve the original internal asset key while it remains the Flutter
  // package's default operating shader.
  writeFile(
    new URL("operating_overlay.frag", flutterShaders),
    flutterFragmentSource(operatingShaderFragmentSources.subtle),
  ),
]);
