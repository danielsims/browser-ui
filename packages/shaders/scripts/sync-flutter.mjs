import { writeFile } from "node:fs/promises";

import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVariants,
} from "../dist/index.js";
import { dartConfigurationSource } from "./dart-source.mjs";
import { flutterFragmentSource } from "./flutter-source.mjs";

const flutterShaders = new URL("../../flutter/shaders/", import.meta.url);
const flutterLibrary = new URL("../../flutter/lib/src/", import.meta.url);

await Promise.all([
  ...operatingShaderVariants.map((variant) =>
    writeFile(
      new URL(`operating_${variant}.frag`, flutterShaders),
      flutterFragmentSource(operatingShaderFragmentSources[variant]),
    ),
  ),
  // Preserve the original internal asset key while it remains the Flutter
  // package's default operating shader.
  writeFile(
    new URL("operating_overlay.frag", flutterShaders),
    flutterFragmentSource(operatingShaderFragmentSources.subtle),
  ),
  writeFile(
    new URL("operating_shader_configuration.dart", flutterLibrary),
    dartConfigurationSource({
      directions: operatingShaderDirections,
      meta: operatingShaderMeta,
      speeds: operatingShaderSpeeds,
      variants: operatingShaderVariants,
    }),
  ),
]);
