import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  decodeBrowserSessionBinaryFrame,
  encodeBrowserSessionBinaryFrame,
} from "../dist/index.js";

const fixtures = JSON.parse(
  readFileSync(
    new URL(
      "../../flutter/test/fixtures/protocol/messages.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const jpeg = Uint8Array.from(fixtures.binaryFrame.jpeg);
const header = fixtures.binaryFrame.header;

test("round-trips a bounded binary JPEG frame", () => {
  const encoded = encodeBrowserSessionBinaryFrame(header, jpeg);
  const decoded = decodeBrowserSessionBinaryFrame(encoded);
  assert.deepEqual(decoded?.header, header);
  assert.deepEqual(decoded?.jpeg, jpeg);
});

test("rejects malformed and oversized binary frames", () => {
  const encoded = encodeBrowserSessionBinaryFrame(header, jpeg);
  encoded[0] = 0;
  assert.equal(decodeBrowserSessionBinaryFrame(encoded), null);
  assert.equal(
    decodeBrowserSessionBinaryFrame(
      encodeBrowserSessionBinaryFrame(header, jpeg),
      2,
    ),
    null,
  );
});
