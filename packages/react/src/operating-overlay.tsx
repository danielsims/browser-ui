"use client";

import type { BrowserOperatingShaderOptions } from "./operating-shader";
import { BrowserOperatingShader } from "./operating-shader";

export interface BrowserOperatingOverlayProps {
  label?: string;
  onTakeControl?: () => void;
  shader?: BrowserOperatingShaderOptions;
  takeControlLabel?: string;
}

export function BrowserOperatingOverlay({
  label = "Agent is operating this browser",
  onTakeControl,
  shader,
  takeControlLabel = "Take control",
}: BrowserOperatingOverlayProps) {
  return (
    <div
      aria-label={onTakeControl ? takeControlLabel : undefined}
      className="bui-operating-overlay"
      data-shader-variant={shader?.variant ?? "subtle"}
      onClick={onTakeControl}
      onKeyDown={(event) => {
        if (!onTakeControl || (event.key !== "Enter" && event.key !== " "))
          return;
        event.preventDefault();
        onTakeControl();
      }}
      role={onTakeControl ? "button" : undefined}
      tabIndex={onTakeControl ? 0 : undefined}
    >
      <div aria-hidden className="bui-operating-fallback" />
      <BrowserOperatingShader {...shader} />
      <div className="bui-operating-status">
        <span className="bui-operating-shimmer" role="status">
          {label}
        </span>
      </div>
    </div>
  );
}
