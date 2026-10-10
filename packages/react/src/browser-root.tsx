"use client";

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { motion, MotionConfig } from "motion/react";
import { createPortal } from "react-dom";

import type { BrowserDisplayMode } from "./browser-display";
import type { BrowserPictureInPictureOptions } from "./browser-picture-in-picture";
import { BrowserDisplayProvider } from "./browser-display";
import { useBrowserDisplayLifecycle, useBrowserLayout } from "./browser-layout";
import { useBrowserPictureInPicture } from "./browser-picture-in-picture";

export type BrowserVariant = "framed" | "bare";
export type BrowserColorScheme = "light" | "dark" | "system";

export interface BrowserRootProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  variant?: BrowserVariant;
  defaultMode?: BrowserDisplayMode;
  mode?: BrowserDisplayMode;
  onModeChange?: (mode: BrowserDisplayMode) => void;
  colorScheme?: BrowserColorScheme;
  /** Stable Motion layout identity for the live browser frame. */
  layoutId?: string;
  /** Optional element whose visible bounds fullscreen mode should fill. */
  fullscreenTarget?: HTMLElement | null;
  /** Optional container, drag, and snap policy for picture-in-picture mode. */
  pictureInPicture?: BrowserPictureInPictureOptions;
}

const layoutTransition = {
  type: "spring",
  visualDuration: 0.42,
  bounce: 0.08,
} as const;

/** Layout and display-mode root shared by live and custom transports. */
export const BrowserRoot = forwardRef<HTMLElement, BrowserRootProps>(
  function BrowserRoot(
    {
      children,
      className,
      colorScheme = "light",
      defaultMode = "inline",
      fullscreenTarget,
      layoutId: providedLayoutId,
      mode: controlledMode,
      onModeChange,
      pictureInPicture,
      style,
      variant = "framed",
      ...props
    },
    forwardedRef,
  ) {
    const frameRef = useRef<HTMLDivElement>(null);
    const inlineHostRef = useRef<HTMLDivElement>(null);
    const portalHostRef = useRef<HTMLDivElement>(null);
    const rootRef = useRef<HTMLElement>(null);
    const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
    const [controlsVisible, setControlsVisible] = useState(false);
    const [localMode, setLocalMode] = useState<BrowserDisplayMode>(defaultMode);
    const generatedLayoutId = useId();
    const layoutId = providedLayoutId ?? `browser-ui-${generatedLayoutId}`;
    const mode = controlledMode ?? localMode;
    const pictureInPictureLayout = useBrowserPictureInPicture({
      frameRef,
      frameMounted: portalHost !== null,
      mode,
      options: pictureInPicture,
      portalHostRef,
    });
    const resetPictureInPicture = pictureInPictureLayout.resetToDefault;
    const { retainedHeight } = useBrowserLayout({
      frameMounted: portalHost !== null,
      frameRef,
      fullscreenTarget,
      inlineHostRef,
      mode,
      portalHost,
      preservePictureInPictureSpace:
        pictureInPicture?.preserveInlineSpace === true,
    });

    const setRootRef = useCallback(
      (node: HTMLElement | null) => {
        rootRef.current = node;
        if (typeof forwardedRef === "function") forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      },
      [forwardedRef],
    );

    const commitMode = useCallback(
      (nextMode: BrowserDisplayMode) => {
        if (nextMode === "picture-in-picture") resetPictureInPicture();
        if (controlledMode === undefined) setLocalMode(nextMode);
        onModeChange?.(nextMode);
      },
      [controlledMode, onModeChange, resetPictureInPicture],
    );

    const setMode = useCallback(
      (nextMode: BrowserDisplayMode) => {
        if (nextMode !== mode) commitMode(nextMode);
      },
      [commitMode, mode],
    );

    const toggleTouchControls = useCallback(
      (pointerType: string, target: EventTarget) => {
        if (pointerType !== "touch" && pointerType !== "pen") return;
        if (
          target instanceof Element &&
          target.closest("button,[role='button']")
        )
          return;
        setControlsVisible((visible) => !visible);
      },
      [],
    );
    const exitDisplayMode = useCallback(
      () => commitMode("inline"),
      [commitMode],
    );

    useBrowserDisplayLifecycle({
      mode,
      onExit: exitDisplayMode,
    });

    useLayoutEffect(() => {
      const inlineHost = inlineHostRef.current;
      if (!inlineHost) return;
      const host = document.createElement("div");
      host.className = "bui-browser-portal";
      portalHostRef.current = host;
      inlineHost.appendChild(host);
      setPortalHost(host);
      return () => {
        portalHostRef.current = null;
        host.remove();
      };
    }, []);

    const rootStyle: CSSProperties | undefined =
      retainedHeight === undefined
        ? style
        : { ...style, minHeight: retainedHeight };
    const frameModeClass =
      mode === "picture-in-picture"
        ? "bui-browser-frame--pip"
        : mode === "fullscreen"
          ? "bui-browser-frame--fullscreen"
          : "";
    const frame = (
      <motion.div
        ref={frameRef}
        drag={mode === "picture-in-picture" && pictureInPictureLayout.draggable}
        dragConstraints={portalHostRef}
        dragControls={pictureInPictureLayout.dragControls}
        dragElastic={0.04}
        dragListener={false}
        dragMomentum={false}
        layout
        layoutDependency={mode}
        layoutId={layoutId}
        className={[
          "bui-browser-frame",
          `bui-browser-frame--${variant}`,
          frameModeClass,
        ]
          .filter(Boolean)
          .join(" ")}
        data-color-scheme={colorScheme}
        data-controls-visible={controlsVisible ? "true" : undefined}
        data-mode={mode}
        data-pip-draggable={
          mode === "picture-in-picture" && pictureInPictureLayout.draggable
            ? "true"
            : undefined
        }
        data-pip-snap-point={
          mode === "picture-in-picture"
            ? pictureInPictureLayout.snapPoint
            : undefined
        }
        style={{
          x: pictureInPictureLayout.dragX,
          y: pictureInPictureLayout.dragY,
        }}
        onDragEnd={pictureInPictureLayout.onDragEnd}
        onDragStart={pictureInPictureLayout.onDragStart}
        onPointerDownCapture={pictureInPictureLayout.onPointerDown}
        onPointerUp={(event) =>
          toggleTouchControls(event.pointerType, event.target)
        }
      >
        <motion.span
          aria-hidden="true"
          className="bui-browser-frame-decoration"
        />
        {children}
      </motion.div>
    );
    return (
      <MotionConfig reducedMotion="user" transition={layoutTransition}>
        <BrowserDisplayProvider mode={mode} setMode={setMode}>
          <section
            {...props}
            ref={setRootRef}
            className={["bui-browser", `bui-browser--${variant}`, className]
              .filter(Boolean)
              .join(" ")}
            data-color-scheme={colorScheme}
            data-mode={mode}
            data-pip-preserve-inline-space={
              mode === "picture-in-picture" &&
              pictureInPicture?.preserveInlineSpace === true
                ? "true"
                : undefined
            }
            style={rootStyle}
          >
            <div ref={inlineHostRef} className="bui-browser-inline-host" />
            {portalHost ? createPortal(frame, portalHost) : null}
          </section>
        </BrowserDisplayProvider>
      </MotionConfig>
    );
  },
);
