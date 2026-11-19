import type { AgentBrowserFrameMetadata } from "@browser-ui/core";

export interface JpegFrame {
  data: string | ArrayBuffer;
  metadata: AgentBrowserFrameMetadata;
}

export interface JpegFrameDrawerOptions {
  canvas: () => HTMLCanvasElement | null;
  closed: () => boolean;
  /** A frame reached the canvas. */
  onDrawn: (metadata: AgentBrowserFrameMetadata) => void;
}

/**
 * Draws JPEG frames as fast as they decode, always the newest: frames that
 * arrive while one decodes replace each other rather than queue.
 */
export function createJpegFrameDrawer({
  canvas,
  closed,
  onDrawn,
}: JpegFrameDrawerOptions) {
  let decoding = false;
  let pending: JpegFrame | null = null;
  const drawLatest = async () => {
    if (decoding || !pending) return;
    decoding = true;
    try {
      while (!closed() && pending) {
        const frame = pending;
        pending = null;
        let bitmap: ImageBitmap | undefined;
        try {
          const jpeg =
            typeof frame.data === "string"
              ? decodeBase64(frame.data).buffer
              : frame.data;
          bitmap = await createImageBitmap(
            new Blob([jpeg], { type: "image/jpeg" }),
          );
          if (closed()) break;
          const target = canvas();
          if (target) {
            if (target.width !== bitmap.width) target.width = bitmap.width;
            if (target.height !== bitmap.height) target.height = bitmap.height;
            target.getContext("2d")?.drawImage(bitmap, 0, 0);
            onDrawn(frame.metadata);
          }
        } catch {
          // Keep the last valid frame. A malformed frame must not kill the stream.
        } finally {
          bitmap?.close();
        }
      }
    } finally {
      decoding = false;
      if (!closed() && pending) void drawLatest();
    }
  };
  return {
    draw(frame: JpegFrame) {
      pending = frame;
      void drawLatest();
    },
    clear() {
      pending = null;
    },
  };
}

function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
