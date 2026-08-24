"use client";

import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type { BrowserDisplayMode } from "./browser-display";

interface UseBrowserLayoutOptions {
  frameRef: RefObject<HTMLDivElement | null>;
  frameMounted: boolean;
  fullscreenTarget?: HTMLElement | null;
  inlineHostRef: RefObject<HTMLDivElement | null>;
  mode: BrowserDisplayMode;
  portalHost: HTMLDivElement | null;
  preservePictureInPictureSpace: boolean;
}

const fullscreenTargetProperties = [
  "--bui-fullscreen-top",
  "--bui-fullscreen-left",
  "--bui-fullscreen-width",
  "--bui-fullscreen-height",
  "--bui-fullscreen-radius",
] as const;
let bodyScrollLockCount = 0;
let bodyOverflowBeforeLock = "";

export function useBrowserLayout({
  frameMounted,
  frameRef,
  fullscreenTarget,
  inlineHostRef,
  mode,
  portalHost,
  preservePictureInPictureSpace,
}: UseBrowserLayoutOptions) {
  const [inlineHeight, setInlineHeight] = useState<number | undefined>();

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
    const frame = frameRef.current;
    if (!frame) return;
    const updateLayout = () => {
      if (mode === "inline")
        setInlineHeight(frame.getBoundingClientRect().height);
    };

    updateLayout();
    const observer = new ResizeObserver(updateLayout);
    observer.observe(frame);
    const surface = frame.querySelector<HTMLElement>(".bui-browser-surface");
    if (surface) observer.observe(surface);
    return () => observer.disconnect();
  }, [frameMounted, frameRef, mode]);

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
    retainedHeight:
      mode === "fullscreen" ||
      (mode === "picture-in-picture" && preservePictureInPictureSpace)
        ? inlineHeight
        : undefined,
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
