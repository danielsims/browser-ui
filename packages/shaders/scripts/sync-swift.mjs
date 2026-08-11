import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVariants,
} from "../dist/index.js";
import { metalLibrarySource } from "./metal-source.mjs";
import { swiftConfigurationSource } from "./swift-source.mjs";

const targetArgument = process.argv
  .slice(2)
  .find((argument) => argument !== "--");
const target = targetArgument
  ? pathToFileURL(`${resolve(targetArgument)}/`)
  : new URL("../../swift/Sources/BrowserUI/", import.meta.url);
const shaderDirectory = new URL("Shaders/", target);
await mkdir(shaderDirectory, { recursive: true });
await Promise.all([
  writeFile(
    new URL("BrowserOperatingShader.metal", shaderDirectory),
    metalLibrarySource(operatingShaderFragmentSources, operatingShaderVariants),
  ),
  writeFile(
    new URL("BrowserOperatingShaderConfiguration.swift", target),
    swiftConfigurationSource({
      directions: operatingShaderDirections,
      meta: operatingShaderMeta,
      speeds: operatingShaderSpeeds,
      variants: operatingShaderVariants,
    }),
  ),
]);
