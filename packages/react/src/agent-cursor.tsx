"use client";

import type { HTMLAttributes } from "react";

export type BrowserAgentCursorVariant = "light" | "dark";

export interface BrowserAgentCursorState {
  /** Horizontal position normalized to the remote viewport, from 0 to 1. */
  x: number;
  /** Vertical position normalized to the remote viewport, from 0 to 1. */
  y: number;
  label?: string;
  pressed?: boolean;
  typing?: boolean;
  visible?: boolean;
  /** Visual treatment for light or dark page content. */
  variant?: BrowserAgentCursorVariant;
}

export interface BrowserAgentCursorProps extends HTMLAttributes<HTMLDivElement>, BrowserAgentCursorState {}

/** A transport-neutral cursor for visualizing recorded or live agent actions. */
export function BrowserAgentCursor({
  className,
  label,
  pressed = false,
  style,
  typing = false,
  variant = "light",
  visible = true,
  x,
  y,
  ...props
}: BrowserAgentCursorProps) {
  return <div
    {...props}
    aria-hidden="true"
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
    } as React.CSSProperties}
  >
    <span className="bui-agent-cursor-ripple" />
    <svg viewBox="0 0 22 26"><path d="M2.25 2.25v18.9l4.8-4.68 3.25 7.02 3.65-1.72-3.2-6.82h6.62L2.25 2.25Z" /></svg>
    {label ? <small>{label}</small> : null}
  </div>;
}
