"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent, type VideoHTMLAttributes } from "react";
import { BrowserAgentCursor, type BrowserAgentCursorState } from "./agent-cursor";
import { BrowserDisplayControls, BrowserFullscreenTrigger, BrowserPictureInPictureTrigger } from "./browser-display";
import { BrowserRoot, type BrowserRootProps } from "./browser-root";
import { BrowserOperatingOverlay } from "./operating-overlay";
import type { BrowserOperatingShaderOptions } from "./operating-shader";
import { BrowserSurface } from "./browser-surface";
import type { BrowserViewportSize } from "./agent-browser-viewport";
import type { BrowserRecordingTimelineEvent } from "@browser-ui/core";

export type { BrowserRecordingTimelineEvent } from "@browser-ui/core";

export interface BrowserRecordingProps extends Omit<BrowserRootProps, "children"> {
  /** WebM or another browser-supported recording produced by agent-browser. */
  src: string;
  /** Original recording resolution, used only to preserve the intended aspect ratio. */
  viewportSize?: BrowserViewportSize;
  /** CSS aspect-ratio for the rendered component, independent from viewportSize. */
  displayAspectRatio?: CSSProperties["aspectRatio"];
  ariaLabel?: string;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playbackRate?: number;
  /** Media time in seconds to seek to before playback begins. */
  startTime?: number;
  preload?: "none" | "metadata" | "auto";
  operating?: boolean;
  operatingLabel?: string;
  /** Visual treatment for the active agent overlay. */
  operatingShader?: BrowserOperatingShaderOptions;
  /** Called when the person takes control from the recorded workflow overlay. */
  onTakeControl?: () => void;
  /** Optional normalized cursor captured alongside the recording. */
  agentCursor?: BrowserAgentCursorState;
  /**
   * Optional action and cursor events captured beside the video. They replay
   * in sync with the media without changing the recording itself.
   */
  timeline?: readonly BrowserRecordingTimelineEvent[];
  showPictureInPicture?: boolean;
  showFullscreen?: boolean;
  displayControls?: ReactNode;
  displayControlsClassName?: string;
  videoClassName?: string;
  videoProps?: Omit<VideoHTMLAttributes<HTMLVideoElement>, "aria-label" | "autoPlay" | "className" | "loop" | "muted" | "onEnded" | "playsInline" | "preload" | "src">;
  onEnded?: VideoHTMLAttributes<HTMLVideoElement>["onEnded"];
}

/**
 * A static, non-interactive recording surface for the native WebM output from
 * `agent-browser record start`. Use Browser for a live, pair-browsable stream.
 */
export const BrowserRecording = forwardRef<HTMLVideoElement, BrowserRecordingProps>(function BrowserRecording({
  agentCursor,
  ariaLabel = "Recorded browser workflow",
  autoPlay = true,
  className,
  colorScheme,
  defaultMode,
  displayControls,
  displayControlsClassName,
  displayAspectRatio,
  loop = false,
  mode,
  muted = true,
  onEnded,
  onModeChange,
  onTakeControl,
  operating = false,
  operatingLabel = "Agent is operating this browser",
  operatingShader,
  playbackRate = 1,
  preload = "metadata",
  showFullscreen = false,
  showPictureInPicture = false,
  src,
  startTime = 0,
  style,
  timeline,
  variant = "framed",
  videoClassName,
  videoProps,
  viewportSize,
  ...rootProps
}: BrowserRecordingProps, forwardedRef) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [playbackReady, setPlaybackReady] = useState(startTime <= 0);
  const timelineIndexRef = useRef(-1);
  const timelineRef = useRef(timeline);
  const initialTimeline = recordingTimelineState(timeline, startTime * 1000);
  const [timelineState, setTimelineState] = useState(initialTimeline.state);
  useImperativeHandle(forwardedRef, () => videoRef.current!, []);
  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideoElement(node);
  }, []);

  useEffect(() => {
    timelineRef.current = timeline;
    const initial = recordingTimelineState(timeline, startTime * 1000);
    timelineIndexRef.current = initial.index;
    setTimelineState(initial.state);
  }, [startTime, timeline]);

  useEffect(() => setPlaybackReady(startTime <= 0), [src, startTime]);

  useEffect(() => {
    if (videoElement) videoElement.playbackRate = playbackRate;
  }, [playbackRate, videoElement]);

  useEffect(() => {
    const video = videoElement;
    if (!video || !autoPlay || !playbackReady) return;
    const resumePlayback = () => {
      if (document.visibilityState !== "visible" || video.ended) return;
      void video.play().catch(() => undefined);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") resumePlayback();
    };
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resumePlayback();
    video.addEventListener("canplay", resumePlayback);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", resumePlayback);
    window.addEventListener("pageshow", resumePlayback);
    return () => {
      video.removeEventListener("canplay", resumePlayback);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", resumePlayback);
      window.removeEventListener("pageshow", resumePlayback);
    };
  }, [autoPlay, playbackReady, src, videoElement]);

  const syncTimelineAt = useCallback((elapsed: number) => {
    const entries = timelineRef.current;
    if (!entries?.length) return;
    const next = recordingTimelineState(entries, elapsed);
    const nextIndex = next.index;
    if (nextIndex === timelineIndexRef.current) return;
    timelineIndexRef.current = nextIndex;
    setTimelineState(next.state);
  }, []);
  const syncTimeline = useCallback(() => {
    if (videoElement && videoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
      syncTimelineAt(videoElement.currentTime * 1000);
    }
  }, [syncTimelineAt, videoElement]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !timeline?.length) return;
    let animationFrame = 0;
    const tick = () => {
      syncTimeline();
      if (!video.paused && !video.ended) animationFrame = requestAnimationFrame(tick);
    };
    const start = () => { cancelAnimationFrame(animationFrame); tick(); };
    const stop = () => cancelAnimationFrame(animationFrame);
    video.addEventListener("play", start);
    video.addEventListener("pause", stop);
    video.addEventListener("ended", stop);
    syncTimeline();
    if (!video.paused) start();
    return () => {
      cancelAnimationFrame(animationFrame);
      video.removeEventListener("play", start);
      video.removeEventListener("pause", stop);
      video.removeEventListener("ended", stop);
    };
  }, [syncTimeline, timeline, videoElement]);

  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    timelineIndexRef.current = -1;
    setTimelineState({});
    onEnded?.(event);
  }, [onEnded]);
  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const video = event.currentTarget;
    const target = Math.min(Math.max(0, startTime), Number.isFinite(video.duration) ? video.duration : startTime);
    if (target > 0 && Math.abs(video.currentTime - target) > .05) {
      video.currentTime = target;
    } else setPlaybackReady(true);
    videoProps?.onLoadedMetadata?.(event);
  }, [startTime, videoProps]);
  const handleSeeked = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (Math.abs(event.currentTarget.currentTime - startTime) <= .05) setPlaybackReady(true);
    videoProps?.onSeeked?.(event);
  }, [startTime, videoProps]);
  const handleSeeking = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    syncTimelineAt(event.currentTarget.currentTime * 1000);
    videoProps?.onSeeking?.(event);
  }, [syncTimelineAt, videoProps]);
  const handleTimeUpdate = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    syncTimelineAt(event.currentTarget.currentTime * 1000);
    videoProps?.onTimeUpdate?.(event);
  }, [syncTimelineAt, videoProps]);
  const recordingAspectRatio = displayAspectRatio ?? (viewportSize ? `${viewportSize.width} / ${viewportSize.height}` : undefined);
  const rootStyle = {
    ...style,
    ...(recordingAspectRatio ? { "--bui-browser-aspect-ratio": recordingAspectRatio } : {}),
  } as CSSProperties;

  return <BrowserRoot
    {...rootProps}
    className={className}
    colorScheme={colorScheme}
    defaultMode={defaultMode}
    mode={mode}
    onModeChange={onModeChange}
    style={rootStyle}
    variant={variant}
  >
    <BrowserSurface
      className="bui-browser-surface bui-recording-surface"
      overlay={<>
        {operating ? <BrowserOperatingOverlay label={timelineState.operatingLabel ?? operatingLabel} onTakeControl={onTakeControl} shader={operatingShader} /> : null}
        {timelineState.agentCursor ?? agentCursor ? <BrowserAgentCursor {...(timelineState.agentCursor ?? agentCursor)!} /> : null}
      </>}
      style={{ aspectRatio: recordingAspectRatio }}
    >
      <video
        {...videoProps}
        ref={setVideoNode}
        aria-label={ariaLabel}
        autoPlay={autoPlay && playbackReady}
        className={["bui-recording", videoClassName].filter(Boolean).join(" ")}
        loop={loop}
        muted={muted}
        onEnded={handleEnded}
        onLoadedMetadata={handleLoadedMetadata}
        onSeeked={handleSeeked}
        onSeeking={handleSeeking}
        onTimeUpdate={handleTimeUpdate}
        playsInline
        preload={preload}
        src={src}
      />
      {showPictureInPicture || showFullscreen || displayControls ? <BrowserDisplayControls className={displayControlsClassName}>
        {displayControls}
        {showPictureInPicture ? <BrowserPictureInPictureTrigger /> : null}
        {showFullscreen ? <BrowserFullscreenTrigger /> : null}
      </BrowserDisplayControls> : null}
    </BrowserSurface>
  </BrowserRoot>;
});

function recordingTimelineState(
  entries: readonly BrowserRecordingTimelineEvent[] | undefined,
  elapsed: number,
): {
  index: number;
  state: Pick<BrowserRecordingTimelineEvent, "agentCursor" | "operatingLabel">;
} {
  if (!entries?.length) return { index: -1, state: {} };
  let low = 0;
  let high = entries.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (entries[middle].at <= elapsed) {
      index = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  if (index < 0) return { index, state: {} };
  let agentCursor: BrowserAgentCursorState | undefined;
  let operatingLabel: string | undefined;
  for (let current = index; current >= 0 && (agentCursor === undefined || operatingLabel === undefined); current -= 1) {
    agentCursor ??= entries[current].agentCursor;
    operatingLabel ??= entries[current].operatingLabel;
  }
  return { index, state: { agentCursor, operatingLabel } };
}
