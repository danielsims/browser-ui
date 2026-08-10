import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVariants,
  operatingShaderVertexSource,
} from "../dist/index.js";

const outputDirectory = fileURLToPath(new URL("../dist/assets/", import.meta.url));
await mkdir(outputDirectory, { recursive: true });

const manifest = {
  schemaVersion: 1,
  variants: operatingShaderVariants,
  meta: operatingShaderMeta,
  directions: operatingShaderDirections,
  speeds: operatingShaderSpeeds,
};

await Promise.all([
  writeFile(
    new URL("../dist/assets/manifest.json", import.meta.url),
    `${JSON.stringify(manifest, null, 2)}\n`,
  ),
  writeFile(new URL("../dist/assets/vertex.vert", import.meta.url), operatingShaderVertexSource),
  ...operatingShaderVariants.map((variant) => writeFile(
    new URL(`../dist/assets/${variant}.frag`, import.meta.url),
    operatingShaderFragmentSources[variant],
  )),
]);
