"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { motion, type HTMLMotionProps } from "motion/react";

export interface BrowserSurfaceProps extends Omit<HTMLMotionProps<"div">, "children"> {
  children?: ReactNode;
  loading?: boolean;
  loadingFallback?: ReactNode;
  overlay?: ReactNode;
}

/** Transport-neutral viewport surface. */
export function BrowserSurface({ children, className, loading = false, loadingFallback, overlay, ...props }: BrowserSurfaceProps) {
  return <motion.div layout {...props} style={{ ...props.style, borderRadius: props.style?.borderRadius ?? "var(--bui-surface-radius, 7px)" }} className={["bui-surface", className].filter(Boolean).join(" ")}>
    {children}
    {loading ? loadingFallback : overlay}
  </motion.div>;
}

export interface BrowserLoadingProps extends HTMLAttributes<HTMLDivElement> {
  label?: string;
}

export function BrowserLoading({ className, label = "Opening browser", ...props }: BrowserLoadingProps) {
  return <div {...props} className={["bui-loading", className].filter(Boolean).join(" ")} role="status"><span /><small>{label}</small></div>;
}
