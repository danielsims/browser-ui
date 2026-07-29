"use client";

import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, MotionConfig } from "motion/react";
import { BrowserDisplayProvider, type BrowserDisplayMode } from "./browser-display";
import { useBrowserDisplayLifecycle, useBrowserLayout } from "./browser-layout";

export type BrowserVariant = "framed" | "bare";
export type BrowserColorScheme = "light" | "dark" | "system";

export interface BrowserRootProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: BrowserVariant;
  defaultMode?: BrowserDisplayMode;
  mode?: BrowserDisplayMode;
  onModeChange?: (mode: BrowserDisplayMode) => void;
  colorScheme?: BrowserColorScheme;
  /** Optional element whose visible bounds fullscreen mode should fill. */
  fullscreenTarget?: HTMLElement | null;
}

const layoutTransition = { type: "spring", visualDuration: .42, bounce: .08 } as const;

/** Layout and display-mode root shared by live and custom transports. */
export const BrowserRoot = forwardRef<HTMLElement, BrowserRootProps>(function BrowserRoot({
  children,
  className,
  colorScheme = "light",
  defaultMode = "inline",
  fullscreenTarget,
  mode: controlledMode,
  onModeChange,
  style,
  variant = "framed",
  ...props
}, forwardedRef) {
  const frameRef = useRef<HTMLDivElement>(null);
  const inlineHostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [localMode, setLocalMode] = useState<BrowserDisplayMode>(defaultMode);
  const mode = controlledMode ?? localMode;
  const { prepareModeTransition, retainedHeight } = useBrowserLayout({
    frameMounted: portalHost !== null,
    frameRef,
    fullscreenTarget,
    inlineHostRef,
    mode,
    portalHost,
    rootRef,
  });

  const setRootRef = useCallback((node: HTMLElement | null) => {
    rootRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  const commitMode = useCallback((nextMode: BrowserDisplayMode) => {
    prepareModeTransition();
    if (controlledMode === undefined) setLocalMode(nextMode);
    onModeChange?.(nextMode);
  }, [controlledMode, onModeChange, prepareModeTransition]);

  const setMode = useCallback((nextMode: BrowserDisplayMode) => {
    if (nextMode !== mode) commitMode(nextMode);
  }, [commitMode, mode]);

  const toggleTouchControls = useCallback((pointerType: string, target: EventTarget) => {
    if (pointerType !== "touch" && pointerType !== "pen") return;
    if (target instanceof Element && target.closest("button,[role='button']")) return;
    setControlsVisible((visible) => !visible);
  }, []);
  const exitDisplayMode = useCallback(() => commitMode("inline"), [commitMode]);

  useBrowserDisplayLifecycle({
    mode,
    onExit: exitDisplayMode,
  });

  useLayoutEffect(() => {
    const inlineHost = inlineHostRef.current;
    if (!inlineHost) return;
    const host = document.createElement("div");
    host.className = "bui-browser-portal";
    inlineHost.appendChild(host);
    setPortalHost(host);
    return () => host.remove();
  }, []);

  const rootStyle = retainedHeight === undefined
    ? style
    : ({ ...style, minHeight: retainedHeight } as CSSProperties);
  const frameModeClass = mode === "picture-in-picture"
    ? "bui-browser-frame--pip"
    : mode === "fullscreen" ? "bui-browser-frame--fullscreen" : "";
  const frame = <motion.div
    ref={frameRef}
    className={["bui-browser-frame", `bui-browser-frame--${variant}`, frameModeClass].filter(Boolean).join(" ")}
    data-color-scheme={colorScheme}
    data-controls-visible={controlsVisible ? "true" : undefined}
    data-mode={mode}
    onPointerUp={(event) => toggleTouchControls(event.pointerType, event.target)}
  >
    <motion.span aria-hidden="true" className="bui-browser-frame-decoration" />
    {children}
  </motion.div>;
  return <MotionConfig reducedMotion="user" transition={layoutTransition}>
    <BrowserDisplayProvider mode={mode} setMode={setMode}>
      <section
        {...props}
        ref={setRootRef}
        className={["bui-browser", `bui-browser--${variant}`, className].filter(Boolean).join(" ")}
        data-color-scheme={colorScheme}
        data-mode={mode}
        style={rootStyle}
      >
        <div ref={inlineHostRef} className="bui-browser-inline-host" />
        {portalHost ? createPortal(frame, portalHost) : null}
      </section>
    </BrowserDisplayProvider>
  </MotionConfig>;
});
