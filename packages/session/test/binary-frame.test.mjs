import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeBrowserSessionBinaryFrame,
  encodeBrowserSessionBinaryFrame,
} from "../dist/index.js";

const jpeg = Uint8Array.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
const header = {
  v: 1,
  type: "frame",
  codec: "image/jpeg",
  width: 1280,
  height: 800,
  capturedAt: 1000,
  sourceEpoch: "epoch-one",
  frameSequence: 4,
  viewportRevision: 1,
  metadata: {
    deviceWidth: 1280,
    deviceHeight: 800,
    pageScaleFactor: 1,
    offsetTop: 0,
    scrollOffsetX: 0,
    scrollOffsetY: 0,
  },
};

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
  assert.equal(decodeBrowserSessionBinaryFrame(
    encodeBrowserSessionBinaryFrame(header, jpeg),
    2,
  ), null);
});
