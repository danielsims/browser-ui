"use client";

import type { RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import type { BrowserDisplayMode } from "./browser-display";

interface BrowserLayoutSnapshot {
  frame: DOMRect;
  surface?: DOMRect;
}

interface UseBrowserLayoutOptions {
  frameRef: RefObject<HTMLDivElement | null>;
  frameMounted: boolean;
  fullscreenTarget?: HTMLElement | null;
  inlineHostRef: RefObject<HTMLDivElement | null>;
  mode: BrowserDisplayMode;
  portalHost: HTMLDivElement | null;
  rootRef: RefObject<HTMLElement | null>;
}

const modeTransitionDurationMs = 420;
const modeTransitionFallbackMs = modeTransitionDurationMs + 120;
const fullscreenTargetProperties = [
  "--bui-fullscreen-top",
  "--bui-fullscreen-left",
  "--bui-fullscreen-width",
  "--bui-fullscreen-height",
  "--bui-fullscreen-radius",
] as const;
let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock = "";

function captureBrowserLayout(frame: HTMLDivElement): BrowserLayoutSnapshot {
  const surface = frame.querySelector<HTMLElement>(".bui-surface");
  return {
    frame: frame.getBoundingClientRect(),
    surface: surface?.getBoundingClientRect(),
  };
}

function hasLayout(rect: DOMRect | undefined): rect is DOMRect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function invertLayout(from: DOMRect, to: DOMRect) {
  return [
    `translate3d(${from.left - to.left}px, ${from.top - to.top}px, 0)`,
    `scale(${from.width / to.width}, ${from.height / to.height})`,
  ].join(" ");
}

function startLayoutTransition(
  target: HTMLElement,
  from: DOMRect,
  to: DOMRect,
) {
  target.style.transition = "none";
  target.style.transformOrigin = "top left";
  target.style.transform = invertLayout(from, to);
  target.style.willChange = "transform";
  void target.offsetWidth;
  target.dataset.modeTransitioning = "true";
  target.style.transition = `transform ${modeTransitionDurationMs}ms cubic-bezier(.22, 1, .36, 1)`;
  target.style.transform = "translate3d(0, 0, 0) scale(1, 1)";
}

export function useBrowserLayout({
  frameMounted,
  frameRef,
  fullscreenTarget,
  inlineHostRef,
  mode,
  portalHost,
  rootRef,
}: UseBrowserLayoutOptions) {
  const [inlineHeight, setInlineHeight] = useState<number | undefined>();
  const lastLayoutRef = useRef<BrowserLayoutSnapshot | null>(null);
  const modeTransitionCleanupRef = useRef<(() => void) | null>(null);
  const transitionFromRef = useRef<BrowserLayoutSnapshot | null>(null);
  const transitioningRef = useRef(false);
  const previousModeRef = useRef<BrowserDisplayMode>(mode);

  const prepareModeTransition = useCallback(() => {
    const frame = frameRef.current;
    if (frame) transitionFromRef.current = captureBrowserLayout(frame);
  }, [frameRef]);

  useLayoutEffect(() => {
    const inlineHost = inlineHostRef.current;
    if (!portalHost || !inlineHost) return;
    const target = mode === "inline" ? inlineHost : document.body;
    if (portalHost.parentElement !== target) target.appendChild(portalHost);

    const frame = frameRef.current;
    if (!frame || mode !== "fullscreen" || !fullscreenTarget) return;
    const bounds = fullscreenTarget.getBoundingClientRect();
    const targetStyle = window.getComputedStyle(fullscreenTarget);
    const left = Math.floor(bounds.left);
    const top = Math.floor(bounds.top);
    frame.style.setProperty("--bui-fullscreen-top", `${top}px`);
    frame.style.setProperty("--bui-fullscreen-left", `${left}px`);
    frame.style.setProperty(
      "--bui-fullscreen-width",
      `${Math.ceil(bounds.right) - left}px`,
    );
    frame.style.setProperty(
      "--bui-fullscreen-height",
      `${Math.ceil(bounds.bottom) - top}px`,
    );
    frame.style.setProperty(
      "--bui-fullscreen-radius",
      targetStyle.borderRadius,
    );
  }, [
    frameMounted,
    frameRef,
    fullscreenTarget,
    inlineHostRef,
    mode,
    portalHost,
  ]);

  useLayoutEffect(() => {
    const previousMode = previousModeRef.current;
    if (previousMode === mode) return;
    previousModeRef.current = mode;
    modeTransitionCleanupRef.current?.();

    const frame = frameRef.current;
    const preparedFrom = transitionFromRef.current;
    let from = preparedFrom ?? lastLayoutRef.current;
    transitionFromRef.current = null;
    if (previousMode === "inline" && !preparedFrom && rootRef.current) {
      const anchor = rootRef.current.getBoundingClientRect();
      if (from && hasLayout(from.frame) && hasLayout(anchor)) {
        const offsetX = anchor.left - from.frame.left;
        const offsetY = anchor.top - from.frame.top;
        const surface = from.surface
          ? new DOMRect(
              from.surface.left + offsetX,
              from.surface.top + offsetY,
              from.surface.width,
              from.surface.height,
            )
          : undefined;
        from = { frame: anchor, surface };
      } else if (hasLayout(anchor)) from = { frame: anchor };
    }
    if (
      !frame ||
      !from ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      if (frame) lastLayoutRef.current = captureBrowserLayout(frame);
      return;
    }

    const to = captureBrowserLayout(frame);
    const useSurface = previousMode === "fullscreen" || mode === "fullscreen";
    const target = useSurface
      ? frame.querySelector<HTMLElement>(".bui-surface")
      : frame;
    const fromRect = useSurface ? from.surface : from.frame;
    const toRect = useSurface ? to.surface : to.frame;
    if (!target || !hasLayout(fromRect) || !hasLayout(toRect)) {
      lastLayoutRef.current = to;
      return;
    }

    transitioningRef.current = true;
    frame.dataset.transitioning = "true";
    startLayoutTransition(target, fromRect, toRect);

    let fallback: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (!transitioningRef.current) return;
      transitioningRef.current = false;
      target.removeEventListener("transitionend", handleTransitionEnd);
      target.removeAttribute("data-mode-transitioning");
      frame.removeAttribute("data-transitioning");
      target.style.removeProperty("transform");
      target.style.removeProperty("transform-origin");
      target.style.removeProperty("transition");
      target.style.removeProperty("will-change");
      if (fallback) clearTimeout(fallback);
      fallback = null;
      lastLayoutRef.current = captureBrowserLayout(frame);
      modeTransitionCleanupRef.current = null;
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.target === target && event.propertyName === "transform")
        finish();
    };

    target.addEventListener("transitionend", handleTransitionEnd);
    fallback = setTimeout(finish, modeTransitionFallbackMs);
    modeTransitionCleanupRef.current = finish;
  }, [frameMounted, frameRef, mode, rootRef]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const updateLayout = () => {
      if (!transitioningRef.current)
        lastLayoutRef.current = captureBrowserLayout(frame);
      if (mode === "inline")
        setInlineHeight(frame.getBoundingClientRect().height);
    };

    if (!transitioningRef.current)
      lastLayoutRef.current = captureBrowserLayout(frame);
    const observer = new ResizeObserver(updateLayout);
    observer.observe(frame);
    const surface = frame.querySelector<HTMLElement>(".bui-browser-surface");
    if (surface) observer.observe(surface);
    return () => observer.disconnect();
  }, [frameMounted, frameRef, mode]);

  useEffect(() => () => modeTransitionCleanupRef.current?.(), []);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || mode !== "fullscreen" || !fullscreenTarget) return;

    const updateBounds = () => {
      const bounds = fullscreenTarget.getBoundingClientRect();
      const targetStyle = window.getComputedStyle(fullscreenTarget);
      const left = Math.floor(bounds.left);
      const top = Math.floor(bounds.top);
      frame.style.setProperty("--bui-fullscreen-top", `${top}px`);
      frame.style.setProperty("--bui-fullscreen-left", `${left}px`);
      frame.style.setProperty(
        "--bui-fullscreen-width",
        `${Math.ceil(bounds.right) - left}px`,
      );
      frame.style.setProperty(
        "--bui-fullscreen-height",
        `${Math.ceil(bounds.bottom) - top}px`,
      );
      frame.style.setProperty(
        "--bui-fullscreen-radius",
        targetStyle.borderRadius,
      );
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(fullscreenTarget);
    window.addEventListener("resize", updateBounds);
    window.addEventListener("scroll", updateBounds, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
      window.removeEventListener("scroll", updateBounds, true);
      for (const property of fullscreenTargetProperties) {
        frame.style.removeProperty(property);
      }
    };
  }, [frameRef, fullscreenTarget, mode]);

  return {
    prepareModeTransition,
    retainedHeight: mode === "inline" ? undefined : inlineHeight,
  };
}

interface UseBrowserDisplayLifecycleOptions {
  mode: BrowserDisplayMode;
  onExit: () => void;
}

export function useBrowserDisplayLifecycle({
  mode,
  onExit,
}: UseBrowserDisplayLifecycleOptions) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (mode !== "inline") {
      if (
        !previousFocusRef.current &&
        document.activeElement instanceof HTMLElement
      ) {
        previousFocusRef.current = document.activeElement;
      }
      return;
    }
    const previousFocus = previousFocusRef.current;
    previousFocusRef.current = null;
    if (previousFocus?.isConnected) {
      requestAnimationFrame(() => previousFocus.focus({ preventScroll: true }));
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "fullscreen") return;
    if (bodyScrollLockCount === 0) {
      bodyOverflowBeforeLock = document.body.style.overflow;
    }
    bodyScrollLockCount += 1;
    document.body.style.overflow = "hidden";
    return () => {
      bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
      if (bodyScrollLockCount === 0) {
        document.body.style.overflow = bodyOverflowBeforeLock;
      }
    };
  }, [mode]);

  useEffect(() => {
    if (mode === "inline") return;
    const exitDisplayMode = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onExit();
    };
    window.addEventListener("keydown", exitDisplayMode, true);
    return () => window.removeEventListener("keydown", exitDisplayMode, true);
  }, [mode, onExit]);
}
