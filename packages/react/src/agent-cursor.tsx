"use client";

import type { HTMLAttributes } from "react";
import type {
  BrowserAgentCursorState,
  BrowserAgentCursorVariant,
} from "@browser-ui/core";

export type { BrowserAgentCursorState, BrowserAgentCursorVariant } from "@browser-ui/core";

const cursorPath = "M 6.05 3.02 C 5.72 2.70 5.20 2.94 5.20 3.40 V 20.48 C 5.20 21.12 5.96 21.38 6.38 20.96 L 11.06 16.28 C 11.20 16.14 11.38 16.06 11.57 16.06 H 18.50 C 19.14 16.06 19.43 15.29 18.97 14.84 Z";

export interface BrowserAgentCursorProps extends HTMLAttributes<HTMLDivElement>, BrowserAgentCursorState {}

/** A transport-neutral cursor for visualizing recorded or live agent actions. */
export function BrowserAgentCursor({
  className,
  backgroundColor = "#2f6bff",
  label,
  pressed = false,
  size = 32,
  style,
  typing = false,
  variant = "dark",
  visible = true,
  x,
  y,
  ...props
}: BrowserAgentCursorProps) {
  const cursorSize = Number.isFinite(size) ? Math.max(1, size) : 32;
  const glowOffset = cursorSize <= 32 ? "-3%" : cursorSize <= 64 ? "-2%" : "0%";

  return <div
    {...props}
    aria-hidden={label ? undefined : "true"}
    aria-label={label}
    role={label ? "img" : undefined}
    className={[
      "bui-agent-cursor",
      `bui-agent-cursor--${variant}`,
      pressed ? "bui-agent-cursor--pressed" : "",
      typing ? "bui-agent-cursor--typing" : "",
      visible ? "bui-agent-cursor--visible" : "",
      className,
    ].filter(Boolean).join(" ")}
    style={{
      ...style,
      "--bui-agent-cursor-x": `${Math.max(0, Math.min(1, x)) * 100}%`,
      "--bui-agent-cursor-y": `${Math.max(0, Math.min(1, y)) * 100}%`,
      "--bui-agent-cursor-size": `${cursorSize}px`,
      "--bui-agent-cursor-background": backgroundColor,
      "--bui-agent-cursor-glow-offset": glowOffset,
    } as React.CSSProperties}
  >
    <span className="bui-agent-cursor-glow" />
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path className="bui-agent-cursor-outline" d={cursorPath} />
      <path className="bui-agent-cursor-fill" d={cursorPath} />
    </svg>
    {label ? <span className="bui-agent-cursor-label">{label}</span> : null}
  </div>;
}
