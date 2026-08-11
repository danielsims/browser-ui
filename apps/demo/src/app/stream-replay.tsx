"use client";

import { useEffect, useRef, useState } from "react";

import type {
  BrowserAgentCursorState,
  BrowserDisplayMode,
} from "@browser-ui/react";
import {
  BrowserAgentCursor,
  BrowserDisplayControls,
  BrowserFullscreenTrigger,
  BrowserLoading,
  BrowserOperatingOverlay,
  BrowserPictureInPictureTrigger,
  BrowserRoot,
  BrowserSurface,
} from "@browser-ui/react";

interface ReplayFrame {
  at: number;
  src: string;
}

interface ReplayEvent {
  at: number;
  event: {
    cursor?: BrowserAgentCursorState;
    label?: string;
    pressed?: boolean;
    typing?: boolean;
    type: "cursor" | "cursor-state" | "step";
  };
}

interface BrowserStreamReplayManifest {
  duration: number;
  events: ReplayEvent[];
  frames: ReplayFrame[];
}

export interface BrowserStreamReplayProps {
  manifestSrc: string;
  mode: BrowserDisplayMode;
  onModeChange: (mode: BrowserDisplayMode) => void;
  onTakeControl: () => void;
  operating: boolean;
}

const hiddenCursor: BrowserAgentCursorState = {
  visible: false,
  x: 0.5,
  y: 0.5,
};

/**
 * Plays an exact capture of agent-browser's streamed JPEG frames and companion
 * workflow events. It deliberately has no input path: use Browser for a live
 * pair-browsable session.
 */
export function BrowserStreamReplay({
  manifestSrc,
  mode,
  onModeChange,
  onTakeControl,
  operating,
}: BrowserStreamReplayProps) {
  const [manifestLoad, setManifestLoad] = useState<{
    error: boolean;
    manifest: BrowserStreamReplayManifest | null;
    source: string;
  }>({ error: false, manifest: null, source: manifestSrc });
  const manifest =
    manifestLoad.source === manifestSrc ? manifestLoad.manifest : null;
  const loadError =
    manifestLoad.source === manifestSrc ? manifestLoad.error : false;
  const [frameSrc, setFrameSrc] = useState<string | null>(null);
  const [cursor, setCursor] = useState<BrowserAgentCursorState>(hiddenCursor);
  const [label, setLabel] = useState("Opening browser");
  const replayRef = useRef({
    cursor: hiddenCursor,
    eventIndex: 0,
    frameIndex: 0,
    label: "Opening browser",
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetch(manifestSrc, { signal: controller.signal })
      .then((response) =>
        response.ok
          ? (response.json() as Promise<BrowserStreamReplayManifest>)
          : Promise.reject(new Error("Replay unavailable")),
      )
      .then((nextManifest) => {
        const manifestUrl = new URL(manifestSrc, window.location.href);
        setManifestLoad({
          error: false,
          source: manifestSrc,
          manifest: {
            ...nextManifest,
            events: [...nextManifest.events].sort(
              (left, right) => left.at - right.at,
            ),
            frames: [...nextManifest.frames]
              .sort((left, right) => left.at - right.at)
              .map((frame) => ({
                ...frame,
                src: new URL(frame.src, manifestUrl).href,
              })),
          },
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setManifestLoad({ error: true, manifest: null, source: manifestSrc });
      });
    return () => controller.abort();
  }, [manifestSrc]);

  useEffect(() => {
    if (!manifest?.frames.length) return;
    const firstFrame = manifest.frames[0];
    if (!firstFrame) return;
    const replay = replayRef.current;
    replay.cursor = hiddenCursor;
    replay.eventIndex = 0;
    replay.frameIndex = 0;
    replay.label = "Opening browser";
    let animationFrame = 0;
    let startedAt = 0;
    const preloaded = new Set<string>();
    const preload = (from: number) => {
      for (
        let index = from;
        index < Math.min(from + 12, manifest.frames.length);
        index += 1
      ) {
        const frame = manifest.frames[index];
        if (!frame) continue;
        const { src } = frame;
        if (preloaded.has(src)) continue;
        preloaded.add(src);
        const image = new Image();
        image.src = src;
      }
    };
    const reset = () => {
      replay.cursor = hiddenCursor;
      replay.eventIndex = 0;
      replay.frameIndex = 0;
      replay.label = "Opening browser";
      setCursor(hiddenCursor);
      setLabel(replay.label);
      setFrameSrc(firstFrame.src);
    };
    const tick = (now: number) => {
      if (!startedAt) {
        startedAt = now;
        setCursor(hiddenCursor);
        setLabel(replay.label);
        setFrameSrc(firstFrame.src);
      }
      let elapsed = now - startedAt;
      if (elapsed >= manifest.duration) {
        startedAt = now;
        elapsed = 0;
        reset();
      }
      let nextFrame = manifest.frames[replay.frameIndex + 1];
      while (nextFrame && nextFrame.at <= elapsed) {
        replay.frameIndex += 1;
        setFrameSrc(nextFrame.src);
        nextFrame = manifest.frames[replay.frameIndex + 1];
      }
      preload(replay.frameIndex + 1);
      let cursorChanged = false;
      let labelChanged = false;
      let replayEvent = manifest.events[replay.eventIndex];
      while (replayEvent && replayEvent.at <= elapsed) {
        const { event } = replayEvent;
        if (event.type === "step" && event.label) {
          replay.label = event.label;
          labelChanged = true;
        } else if (event.type === "cursor" && event.cursor) {
          replay.cursor = event.cursor;
          cursorChanged = true;
        } else if (event.type === "cursor-state") {
          replay.cursor = {
            ...replay.cursor,
            pressed: event.pressed,
            typing: event.typing,
          };
          cursorChanged = true;
        }
        replay.eventIndex += 1;
        replayEvent = manifest.events[replay.eventIndex];
      }
      if (labelChanged) setLabel(replay.label);
      if (cursorChanged) setCursor(replay.cursor);
      animationFrame = requestAnimationFrame(tick);
    };
    preload(0);
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [manifest]);

  return (
    <BrowserRoot mode={mode} onModeChange={onModeChange}>
      <BrowserSurface
        className="stream-replay-surface"
        loading={!manifest || loadError}
        loadingFallback={
          <BrowserLoading
            label={loadError ? "Replay unavailable" : "Loading browser replay"}
          />
        }
        overlay={
          <>
            {operating ? (
              <BrowserOperatingOverlay
                label={label}
                onTakeControl={onTakeControl}
              />
            ) : null}
            <BrowserAgentCursor {...cursor} />
          </>
        }
        style={{ aspectRatio: "16 / 10" }}
      >
        {frameSrc ? (
          <img
            alt="Recorded agent-browser session"
            className="stream-replay-frame"
            src={frameSrc}
          />
        ) : null}
        <BrowserDisplayControls>
          <BrowserPictureInPictureTrigger />
          <BrowserFullscreenTrigger />
        </BrowserDisplayControls>
      </BrowserSurface>
    </BrowserRoot>
  );
}
