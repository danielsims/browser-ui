"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { AgentBrowserViewport, type AgentBrowserViewportProps, type BrowserViewportSize } from "./agent-browser-viewport";
import { BrowserOperatingOverlay } from "./operating-overlay";
import { BrowserDisplayControls, BrowserFullscreenTrigger, BrowserPictureInPictureTrigger, BrowserRoot, type BrowserRootProps } from "./browser-root";
import { BrowserLoading, BrowserSurface } from "./browser-surface";
import { BrowserToolbar } from "./browser-toolbar";
import { BrowserAgentCursor, type BrowserAgentCursorState } from "./agent-cursor";
import type { BrowserViewportStatus } from "./protocol";

export interface BrowserProps extends Pick<BrowserRootProps, "className" | "colorScheme" | "defaultMode" | "mode" | "onModeChange" | "style" | "variant">, Pick<AgentBrowserViewportProps, "ariaLabel" | "onViewportResize"> {
  /** WebSocket URL returned by `agent-browser stream status`. */
  streamUrl: string;
  /** Remote browser resolution. It remains stable when the rendered component changes size. */
  viewportSize?: BrowserViewportSize;
  /** CSS aspect-ratio for the rendered component, independent from viewportSize. */
  displayAspectRatio?: CSSProperties["aspectRatio"];
  viewportClassName?: string;
  showControls?: boolean;
  url?: string;
  operating?: boolean;
  operatingLabel?: string;
  /** Optional normalized agent cursor rendered over the live viewport. */
  agentCursor?: BrowserAgentCursorState;
  loadingLabel?: string;
  showPictureInPicture?: boolean;
  showFullscreen?: boolean;
  onNavigate?: (url: string) => void;
  onReload?: () => void;
  onTakeControl?: () => void;
  onStatusChange?: (status: BrowserViewportStatus) => void;
  onUrlChange?: (url: string) => void;
}

/** Composed interactive browser for the official agent-browser stream protocol. */
export function Browser({
  ariaLabel,
  agentCursor,
  className,
  colorScheme,
  defaultMode,
  displayAspectRatio,
  loadingLabel = "Opening browser",
  onNavigate,
  onModeChange,
  onReload,
  onStatusChange,
  onTakeControl,
  onUrlChange,
  onViewportResize,
  operating = false,
  operatingLabel = "Agent is operating this browser",
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
  const [currentUrl, setCurrentUrl] = useState(url);
  const [draftUrl, setDraftUrl] = useState(url);
  useEffect(() => { setCurrentUrl(url); setDraftUrl(url); }, [url]);

  const handleStatusChange = (next: BrowserViewportStatus) => {
    setStatus(next);
    onStatusChange?.(next);
  };
  const handleUrlChange = (next: string) => {
    setCurrentUrl(next);
    setDraftUrl(next);
    onUrlChange?.(next);
  };
  const loading = status !== "connected";
  const loadingCopy = status === "error"
    ? "Browser connection failed"
    : status === "disconnected" ? "Reconnecting browser" : loadingLabel;

  return <BrowserRoot
    className={className}
    colorScheme={colorScheme}
    defaultMode={defaultMode}
    mode={mode}
    onModeChange={onModeChange}
    style={style}
    variant={variant}
  >
    {showControls ? <BrowserToolbar value={draftUrl || currentUrl} onValueChange={setDraftUrl} onNavigate={onNavigate} onReload={onReload} /> : null}
    <BrowserSurface
      className="bui-browser-surface"
      style={{ aspectRatio: displayAspectRatio ?? (viewportSize ? `${viewportSize.width} / ${viewportSize.height}` : undefined) }}
      loading={loading}
      loadingFallback={<BrowserLoading label={loadingCopy} />}
      overlay={<>
        {operating ? <BrowserOperatingOverlay label={operatingLabel} onTakeControl={onTakeControl} /> : null}
        {agentCursor ? <BrowserAgentCursor {...agentCursor} /> : null}
      </>}
    >
      <AgentBrowserViewport
        streamUrl={streamUrl}
        ariaLabel={ariaLabel}
        className={viewportClassName}
        interactive={!operating}
        viewportSize={viewportSize}
        onStatusChange={handleStatusChange}
        onUrlChange={handleUrlChange}
        onViewportResize={onViewportResize}
      />
    </BrowserSurface>
    {showPictureInPicture || showFullscreen ? <BrowserDisplayControls>
      {showPictureInPicture ? <BrowserPictureInPictureTrigger /> : null}
      {showFullscreen ? <BrowserFullscreenTrigger /> : null}
    </BrowserDisplayControls> : null}
  </BrowserRoot>;
}
