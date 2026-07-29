import type { BrowserSessionFrameMetadata } from "./messages.js";
import { BROWSER_SESSION_VERSION } from "./types.js";

const MAGIC = new Uint8Array([0x42, 0x55, 0x49, 0x46]); // BUIF
const PREFIX_LENGTH = 12;
const FRAME_KIND = 1;
const MAXIMUM_HEADER_LENGTH = 64 * 1024;

export interface BrowserSessionBinaryFrameHeader {
  v: typeof BROWSER_SESSION_VERSION;
  type: "frame";
  codec: "image/jpeg";
  width: number;
  height: number;
  capturedAt: number;
  sourceEpoch: string;
  frameSequence: number;
  viewportRevision: number;
  metadata: BrowserSessionFrameMetadata;
}

export interface DecodedBrowserSessionBinaryFrame {
  header: BrowserSessionBinaryFrameHeader;
  jpeg: Uint8Array;
}

export function encodeBrowserSessionBinaryFrame(
  header: BrowserSessionBinaryFrameHeader,
  jpeg: Uint8Array,
): Uint8Array {
  if (!validHeader(header) || jpeg.byteLength === 0) {
    throw new Error("Cannot encode an invalid browser session frame.");
  }
  const encodedHeader = new TextEncoder().encode(JSON.stringify(header));
  if (encodedHeader.byteLength > MAXIMUM_HEADER_LENGTH) {
    throw new Error("Browser session frame header is too large.");
  }
  const result = new Uint8Array(PREFIX_LENGTH + encodedHeader.byteLength + jpeg.byteLength);
  result.set(MAGIC, 0);
  result[4] = BROWSER_SESSION_VERSION;
  result[5] = FRAME_KIND;
  const view = new DataView(result.buffer);
  view.setUint32(8, encodedHeader.byteLength, false);
  result.set(encodedHeader, PREFIX_LENGTH);
  result.set(jpeg, PREFIX_LENGTH + encodedHeader.byteLength);
  return result;
}

export function decodeBrowserSessionBinaryFrame(
  value: ArrayBuffer | ArrayBufferView,
  maximumJpegBytes = 18 * 1024 * 1024,
): DecodedBrowserSessionBinaryFrame | null {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength < PREFIX_LENGTH + 1 || !hasMagic(bytes)) return null;
  if (bytes[4] !== BROWSER_SESSION_VERSION || bytes[5] !== FRAME_KIND) return null;
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(8, false);
  const jpegOffset = PREFIX_LENGTH + headerLength;
  const jpegLength = bytes.byteLength - jpegOffset;
  if (
    headerLength < 2 ||
    headerLength > MAXIMUM_HEADER_LENGTH ||
    jpegOffset >= bytes.byteLength ||
    jpegLength > maximumJpegBytes
  ) return null;
  let header: unknown;
  try {
    header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(PREFIX_LENGTH, jpegOffset),
    ));
  } catch {
    return null;
  }
  if (!validHeader(header)) return null;
  const jpeg = bytes.subarray(jpegOffset);
  if (!isJpeg(jpeg)) return null;
  return { header, jpeg };
}

function validHeader(value: unknown): value is BrowserSessionBinaryFrameHeader {
  if (!isRecord(value) || value.v !== 1 || value.type !== "frame" || value.codec !== "image/jpeg") {
    return false;
  }
  return dimension(value.width) && dimension(value.height) &&
    finite(value.capturedAt) &&
    typeof value.sourceEpoch === "string" && value.sourceEpoch.length <= 128 &&
    nonNegativeInteger(value.frameSequence) &&
    nonNegativeInteger(value.viewportRevision) &&
    validMetadata(value.metadata);
}

function validMetadata(value: unknown): value is BrowserSessionFrameMetadata {
  return isRecord(value) && dimension(value.deviceWidth) && dimension(value.deviceHeight) &&
    finite(value.pageScaleFactor) && finite(value.offsetTop) &&
    finite(value.scrollOffsetX) && finite(value.scrollOffsetY) &&
    (value.timestamp === undefined || finite(value.timestamp));
}

function hasMagic(bytes: Uint8Array): boolean {
  return MAGIC.every((byte, index) => bytes[index] === byte);
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[bytes.byteLength - 2] === 0xff && bytes[bytes.byteLength - 1] === 0xd9;
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 8192;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
