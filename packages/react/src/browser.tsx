"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { AgentBrowserViewport, type AgentBrowserViewportProps, type BrowserViewportSize } from "./agent-browser-viewport";
import { BrowserOperatingOverlay } from "./operating-overlay";
import { BrowserDisplayControls, BrowserFullscreenTrigger, BrowserPictureInPictureTrigger } from "./browser-display";
import { BrowserRoot, type BrowserRootProps } from "./browser-root";
import { BrowserLoading, BrowserSurface } from "./browser-surface";
import { BrowserToolbar } from "./browser-toolbar";
import { BrowserAgentCursor, type BrowserAgentCursorState } from "./agent-cursor";
import type { BrowserSessionAccess, BrowserViewportStatus } from "@browser-ui/core";

export interface BrowserProps extends Pick<BrowserRootProps, "className" | "colorScheme" | "defaultMode" | "fullscreenTarget" | "mode" | "onModeChange" | "style" | "variant">, Pick<AgentBrowserViewportProps, "ariaLabel" | "createWebSocket" | "onViewportResize" | "protocols" | "resolveConnection"> {
  /** WebSocket URL returned by `agent-browser stream status`. */
  streamUrl?: string;
  /** Host-projected access state. Input requires the viewer's active lease. */
  access?: BrowserSessionAccess;
  /** Remote browser resolution. It remains stable when the rendered component changes size. */
  viewportSize?: BrowserViewportSize;
  /** CSS aspect-ratio for the rendered component, independent from viewportSize. */
  displayAspectRatio?: CSSProperties["aspectRatio"];
  viewportClassName?: string;
  showControls?: boolean;
  url?: string;
  operating?: boolean;
  /** Enables local input intent. Defaults to false and still requires gateway-projected access when provided. */
  interactive?: boolean;
  operatingLabel?: string;
  /** Optional normalized agent cursor rendered over the live viewport. */
  agentCursor?: BrowserAgentCursorState;
  loadingLabel?: string;
  showPictureInPicture?: boolean;
  showFullscreen?: boolean;
  /** Additional controls rendered in Browser UI's top-right display-control strip. */
  displayControls?: ReactNode;
  /** Optional class applied to the package-owned display-control strip. */
  displayControlsClassName?: string;
  onNavigate?: (url: string) => void;
  onReload?: () => void;
  onTakeControl?: () => void;
  onInteractionIntent?: AgentBrowserViewportProps["onInteractionIntent"];
  onStatusChange?: (status: BrowserViewportStatus) => void;
  onUrlChange?: (url: string) => void;
}

/** Composed browser viewer for the official agent-browser stream protocol. */
export function Browser({
  ariaLabel,
  access,
  agentCursor,
  className,
  colorScheme,
  createWebSocket,
  defaultMode,
  displayControls,
  displayControlsClassName,
  displayAspectRatio,
  fullscreenTarget,
  interactive = false,
  loadingLabel = "Opening browser",
  onNavigate,
  onModeChange,
  onReload,
  onStatusChange,
  onTakeControl,
  onInteractionIntent,
  onUrlChange,
  onViewportResize,
  operating = false,
  operatingLabel = "Agent is operating this browser",
  protocols,
  resolveConnection,
  mode,
  showControls = false,
  showPictureInPicture = false,
  showFullscreen = false,
  streamUrl,
  style,
  url = "",
  variant = "framed",
  viewportSize,
  viewportClassName,
}: BrowserProps) {
  const [status, setStatus] = useState<BrowserViewportStatus>("connecting");
  const [draftUrl, setDraftUrl] = useState(url);
  useEffect(() => { setDraftUrl(url); }, [url]);

  const handleStatusChange = (next: BrowserViewportStatus) => {
    setStatus(next);
    onStatusChange?.(next);
  };
  const handleUrlChange = (next: string) => {
    setDraftUrl(next);
    onUrlChange?.(next);
  };
  const loading = status !== "connected";
  const loadingCopy = status === "error"
    ? "Browser connection failed"
    : status === "disconnected" ? "Reconnecting browser" : loadingLabel;
  const viewportAspectRatio = viewportSize && viewportSize.height > 0
    ? viewportSize.width / viewportSize.height
    : 1.6;
  const surfaceStyle = {
    "--bui-fullscreen-surface-width": `min(80vw, calc(80dvh * ${viewportAspectRatio}))`,
    aspectRatio: displayAspectRatio ?? viewportAspectRatio,
  } as CSSProperties;
  const rootStyle = {
    ...style,
    "--bui-browser-aspect-ratio": String(displayAspectRatio ?? viewportAspectRatio),
  } as CSSProperties;

  return <BrowserRoot
    className={className}
    colorScheme={colorScheme}
    defaultMode={defaultMode}
    fullscreenTarget={fullscreenTarget}
    mode={mode}
    onModeChange={onModeChange}
    style={rootStyle}
    variant={variant}
  >
    {showControls ? <BrowserToolbar value={draftUrl} onValueChange={setDraftUrl} onNavigate={onNavigate} onReload={onReload} /> : null}
    <BrowserSurface
      className="bui-browser-surface"
      style={surfaceStyle}
      loading={loading}
      loadingFallback={<BrowserLoading label={loadingCopy} />}
      overlay={<>
        {operating ? <BrowserOperatingOverlay label={operatingLabel} onTakeControl={onTakeControl} /> : null}
        {agentCursor ? <BrowserAgentCursor {...agentCursor} /> : null}
      </>}
    >
      <AgentBrowserViewport
        access={access}
        streamUrl={streamUrl}
        protocols={protocols}
        resolveConnection={resolveConnection}
        createWebSocket={createWebSocket}
        ariaLabel={ariaLabel}
        className={viewportClassName}
        interactive={interactive && !operating}
        onInteractionIntent={onInteractionIntent}
        viewportSize={viewportSize}
        onStatusChange={handleStatusChange}
        onUrlChange={handleUrlChange}
        onViewportResize={onViewportResize}
      />
      {showPictureInPicture || showFullscreen || displayControls ? <BrowserDisplayControls className={displayControlsClassName}>
        {displayControls}
        {showPictureInPicture ? <BrowserPictureInPictureTrigger /> : null}
        {showFullscreen ? <BrowserFullscreenTrigger /> : null}
      </BrowserDisplayControls> : null}
    </BrowserSurface>
  </BrowserRoot>;
}
