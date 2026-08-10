import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVariants,
} from "../dist/index.js";
import { flutterFragmentSource } from "../scripts/flutter-source.mjs";

test("publishes every operating shader with tasteful defaults", () => {
  assert.deepEqual(operatingShaderVariants, ["subtle", "prism", "pulse", "tide"]);
  assert.equal(operatingShaderMeta.prism.defaultSpeed, "slow");
  assert.equal(operatingShaderMeta.pulse.defaultDirection, "left-to-right");
  assert.equal(operatingShaderMeta.tide.defaultDirection, "top-left-to-bottom-right");
  assert.equal(operatingShaderSpeeds.slow.durationSeconds, 15);
  assert.equal(operatingShaderSpeeds.fast.durationSeconds, 7);
});

test("keeps all eight non-zero direction vectors", () => {
  assert.equal(Object.keys(operatingShaderDirections).length, 8);
  for (const { vector } of Object.values(operatingShaderDirections)) {
    assert.notDeepEqual(vector, [0, 0]);
  }
});

test("preserves the designed wrapped sweep and pulse treatment", () => {
  for (const variant of ["prism", "pulse", "tide"]) {
    const source = operatingShaderFragmentSources[variant];
    assert.match(source, /const float loopSpan = 1\.0/);
    assert.match(source, /primaryDistance - loopSpan, primaryDistance \+ loopSpan/);
  }
  assert.match(operatingShaderFragmentSources.prism, /mix\(1\.0, easedPulse, 0\.000\)/);
  assert.match(operatingShaderFragmentSources.pulse, /0\.86 - 0\.14 \* cos/);
  assert.match(operatingShaderFragmentSources.tide, /vec3\(0\.220, 0\.540, 0\.550\)/);
});

test("exports platform-neutral assets without changing their source", async () => {
  const manifest = JSON.parse(await readFile(
    new URL("../dist/assets/manifest.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(manifest.variants, operatingShaderVariants);
  for (const variant of operatingShaderVariants) {
    const asset = await readFile(
      new URL(`../dist/assets/${variant}.frag`, import.meta.url),
      "utf8",
    );
    assert.equal(asset, operatingShaderFragmentSources[variant]);
  }
});

test("keeps every Flutter shader generated from the canonical sources", async () => {
  for (const variant of operatingShaderVariants) {
    const flutterSource = await readFile(
      new URL(`../../flutter/shaders/operating_${variant}.frag`, import.meta.url),
      "utf8",
    );
    assert.equal(
      flutterSource,
      flutterFragmentSource(operatingShaderFragmentSources[variant]),
    );
  }

  const defaultSource = await readFile(
    new URL("../../flutter/shaders/operating_overlay.frag", import.meta.url),
    "utf8",
  );
  assert.equal(
    defaultSource,
    flutterFragmentSource(operatingShaderFragmentSources.subtle),
  );
});
