/**
 * The relay stream: a browser session's screen as H.264 and its sound as Opus,
 * on the same WebSocket as the session's JSON messages.
 *
 * Binary messages start with a type byte. Video (`0x01`) has a 16-byte header
 * (type, flags, frame u32, capture-to-send u32 in 0.1 ms, then reserved bytes)
 * and an Annex-B access unit; sound (`0x02`) is one 10 ms Opus packet, 48 kHz
 * stereo. The server's first text message is a `hello`; the viewer answers
 * with the short commands in `relayCommand`.
 */

import type { AgentBrowserFrameMetadata } from "./protocol";

export const RELAY_VIDEO = 0x01;
export const RELAY_AUDIO = 0x02;
export const RELAY_VIDEO_HEADER_BYTES = 16;
/** H.264 High profile, level 4.0: what the relay encodes. */
export const RELAY_VIDEO_CODEC = "avc1.640028";
export const RELAY_AUDIO_SAMPLE_RATE = 48_000;

export interface RelayHello {
  type: "hello";
  /** The screen's size in pixels; input coordinates use the same space. */
  w: number;
  h: number;
  /** The session has sound to offer. */
  audio: boolean;
  /** This viewer paces the stream (it may also be the one allowed input). */
  control: boolean;
}

export interface RelayVideoHeader {
  key: boolean;
  /** A sharpening pass over a still screen. */
  paintover: boolean;
  frame: number;
  /** Capture to send on the server, in milliseconds. */
  pipelineMs: number;
}

export const relayCommand = {
  /** After a frame has been decoded: paces the stream to this viewer. */
  ack: (frame: number) => `a,${frame >>> 0}`,
  /** Asks for a keyframe, after a decode error. */
  keyframe: "kf",
  /** Whether the stream is on screen; nothing is sent while it isn't. */
  video: (on: boolean) => `v,${on ? 1 : 0}`,
  audio: (on: boolean) => `au,${on ? 1 : 0}`,
} as const;

/** A relay `hello`, from a text message or its parsed JSON; otherwise null. */
export function parseRelayHello(value: unknown): RelayHello | null {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof value !== "object" || value === null) return null;
  const hello = value as Record<string, unknown>;
  const size = (n: unknown) =>
    typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 8192;
  return hello.type === "hello" &&
    size(hello.w) &&
    size(hello.h) &&
    typeof hello.audio === "boolean" &&
    typeof hello.control === "boolean"
    ? (hello as unknown as RelayHello)
    : null;
}

/** The relay's screen is the page: input maps onto it at its own size. */
export function relayFrameMetadata(
  hello: RelayHello,
): AgentBrowserFrameMetadata {
  return {
    deviceWidth: hello.w,
    deviceHeight: hello.h,
    pageScaleFactor: 1,
    offsetTop: 0,
    scrollOffsetX: 0,
    scrollOffsetY: 0,
  };
}

export function parseRelayVideoHeader(
  data: Uint8Array,
): RelayVideoHeader | null {
  if (data.byteLength <= RELAY_VIDEO_HEADER_BYTES || data[0] !== RELAY_VIDEO)
    return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = view.getUint8(1);
  return {
    key: (flags & 1) === 1,
    paintover: (flags & 2) === 2,
    frame: view.getUint32(2),
    pipelineMs: view.getUint32(6) / 10,
  };
}
