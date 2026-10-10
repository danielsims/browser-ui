"use client";

import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { animate, useDragControls, useMotionValue } from "motion/react";

import type { BrowserDisplayMode } from "./browser-display";

export type BrowserPictureInPictureSnapPoint =
  "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface BrowserPictureInPictureOptions {
  /** Container whose visible bounds constrain picture-in-picture mode. */
  containerRef?: RefObject<HTMLElement | null>;
  /**
   * Elements inside the container that a settled viewer must not cover when
   * the container has enough free space. If no placement can avoid every
   * element, the viewer remains at its requested snap point.
   */
  avoidRefs?: readonly RefObject<HTMLElement | null>[];
  /** Corners the viewer may snap to after dragging. */
  allowedSnapPoints?: readonly BrowserPictureInPictureSnapPoint[];
  /** Initial snap point for an uncontrolled viewer. Defaults to bottom-right. */
  defaultSnapPoint?: BrowserPictureInPictureSnapPoint;
  /** Controlled snap point. */
  snapPoint?: BrowserPictureInPictureSnapPoint;
  /** Reports a new snap point after a drag. */
  onSnapPointChange?: (snapPoint: BrowserPictureInPictureSnapPoint) => void;
  /** Distance in pixels between the viewer and its container. Defaults to 24. */
  inset?: number;
  /** Whether the picture-in-picture surface can be dragged. Defaults to true. */
  draggable?: boolean;
  /** Keep the inline layout slot while the viewer is floating. Defaults to false. */
  preserveInlineSpace?: boolean;
}

interface PictureInPicturePosition {
  left: number;
  top: number;
}

interface UseBrowserPictureInPictureOptions {
  frameRef: RefObject<HTMLDivElement | null>;
  frameMounted: boolean;
  mode: BrowserDisplayMode;
  options?: BrowserPictureInPictureOptions;
  portalHostRef: RefObject<HTMLDivElement | null>;
}

const allSnapPoints: readonly BrowserPictureInPictureSnapPoint[] = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
];
const noAvoidRefs: readonly RefObject<HTMLElement | null>[] = [];
const snapTransition = {
  type: "spring",
  visualDuration: 0.3,
  bounce: 0.06,
} as const;

const portalProperties = [
  "left",
  "top",
  "width",
  "height",
  "border-radius",
] as const;

function normalizedSnapPoints(
  snapPoints: readonly BrowserPictureInPictureSnapPoint[] | undefined,
) {
  const unique = [...new Set(snapPoints ?? allSnapPoints)];
  return unique.length > 0 ? unique : ["bottom-right" as const];
}

function isSnapPoint(value: string): value is BrowserPictureInPictureSnapPoint {
  return allSnapPoints.some((snapPoint) => snapPoint === value);
}

function snapPointsFromKey(key: string) {
  return normalizedSnapPoints(
    key === "all" ? undefined : key.split("|").filter(isSnapPoint),
  );
}

function pointPosition(
  snapPoint: BrowserPictureInPictureSnapPoint,
  container: DOMRect,
  frame: DOMRect,
  inset: number,
  obstacles: readonly DOMRect[] = [],
): PictureInPicturePosition {
  const maxLeft = Math.max(inset, container.width - frame.width - inset);
  const maxTop = Math.max(inset, container.height - frame.height - inset);
  const requestedPosition = {
    left: snapPoint.endsWith("right") ? maxLeft : inset,
    top: snapPoint.startsWith("bottom") ? maxTop : inset,
  };
  const horizontalCandidates = new Set([requestedPosition.left]);
  const verticalCandidates = new Set([requestedPosition.top]);
  for (const obstacle of obstacles) {
    const obstacleLeft = obstacle.left - container.left;
    const obstacleRight = obstacle.right - container.left;
    const obstacleTop = obstacle.top - container.top;
    const obstacleBottom = obstacle.bottom - container.top;
    horizontalCandidates.add(
      Math.min(maxLeft, Math.max(inset, obstacleLeft - frame.width - inset)),
    );
    horizontalCandidates.add(
      Math.min(maxLeft, Math.max(inset, obstacleRight + inset)),
    );
    verticalCandidates.add(
      Math.min(maxTop, Math.max(inset, obstacleTop - frame.height - inset)),
    );
    verticalCandidates.add(
      Math.min(maxTop, Math.max(inset, obstacleBottom + inset)),
    );
  }

  let bestPosition: PictureInPicturePosition | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const left of horizontalCandidates) {
    for (const top of verticalCandidates) {
      const overlaps = obstacles.some((obstacle) => {
        const obstacleLeft = obstacle.left - container.left;
        const obstacleRight = obstacle.right - container.left;
        const obstacleTop = obstacle.top - container.top;
        const obstacleBottom = obstacle.bottom - container.top;
        return (
          left < obstacleRight &&
          left + frame.width > obstacleLeft &&
          top < obstacleBottom &&
          top + frame.height > obstacleTop
        );
      });
      if (overlaps) continue;
      const distance =
        (left - requestedPosition.left) ** 2 +
        (top - requestedPosition.top) ** 2;
      if (distance < bestDistance) {
        bestPosition = { left, top };
        bestDistance = distance;
      }
    }
  }
  return bestPosition ?? requestedPosition;
}

export function nearestBrowserPictureInPictureSnapPoint(
  position: PictureInPicturePosition,
  snapPoints: readonly BrowserPictureInPictureSnapPoint[],
  container: DOMRect,
  frame: DOMRect,
  inset: number,
  obstacles: readonly DOMRect[],
) {
  let closest = snapPoints[0] ?? "bottom-right";
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const snapPoint of snapPoints) {
    const candidate = pointPosition(
      snapPoint,
      container,
      frame,
      inset,
      obstacles,
    );
    const distance =
      (candidate.left - position.left) ** 2 +
      (candidate.top - position.top) ** 2;
    if (distance < closestDistance) {
      closest = snapPoint;
      closestDistance = distance;
    }
  }
  return closest;
}

function setFramePosition(
  frame: HTMLElement,
  position: PictureInPicturePosition,
) {
  frame.style.setProperty("--bui-pip-left", `${position.left}px`);
  frame.style.setProperty("--bui-pip-top", `${position.top}px`);
}

function layoutBounds(element: HTMLElement) {
  const measured = element.getBoundingClientRect();
  return new DOMRect(
    measured.left,
    measured.top,
    element.offsetWidth || measured.width,
    element.offsetHeight || measured.height,
  );
}

export function cancelBrowserPointerInteraction(
  event: MouseEvent | TouchEvent | PointerEvent,
  frame: HTMLElement,
) {
  if (typeof PointerEvent === "undefined" || !(event instanceof PointerEvent))
    return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  if (!target || target === frame) return;
  target.dispatchEvent(
    new PointerEvent("pointercancel", {
      bubbles: true,
      cancelable: false,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
    }),
  );
}

/** Owns container bounds, drag state, and snap policy for package PiP mode. */
export function useBrowserPictureInPicture({
  frameRef,
  frameMounted,
  mode,
  options,
  portalHostRef,
}: UseBrowserPictureInPictureOptions) {
  const allowedSnapPointInput = options?.allowedSnapPoints;
  const avoidRefs = options?.avoidRefs ?? noAvoidRefs;
  const containerRef = options?.containerRef;
  const controlledSnapPoint = options?.snapPoint;
  const onSnapPointChange = options?.onSnapPointChange;
  const inset = Math.max(0, options?.inset ?? 24);
  const draggable = Boolean(containerRef) && options?.draggable !== false;
  const allowedKey = allowedSnapPointInput?.join("|") ?? "all";
  const allowedSnapPoints = useMemo(
    () => snapPointsFromKey(allowedKey),
    [allowedKey],
  );
  const initialSnapPoint =
    options?.defaultSnapPoint ?? controlledSnapPoint ?? "bottom-right";
  const defaultSnapPoint = allowedSnapPoints.includes(initialSnapPoint)
    ? initialSnapPoint
    : (allowedSnapPoints[0] ?? "bottom-right");
  const [localSnapPoint, setLocalSnapPoint] =
    useState<BrowserPictureInPictureSnapPoint>(defaultSnapPoint);
  const requestedSnapPoint = controlledSnapPoint ?? localSnapPoint;
  const snapPoint = allowedSnapPoints.includes(requestedSnapPoint)
    ? requestedSnapPoint
    : (allowedSnapPoints[0] ?? "bottom-right");
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const dragY = useMotionValue(0);
  const draggingRef = useRef(false);
  const previousModeRef = useRef(mode);
  const activeSnapPointRef = useRef(snapPoint);
  const snapAnimationsRef = useRef<ReturnType<typeof animate>[]>([]);

  const stopSnapAnimations = useCallback(() => {
    for (const animation of snapAnimationsRef.current) animation.stop();
    snapAnimationsRef.current = [];
  }, []);

  const commitSnapPoint = useCallback(
    (nextSnapPoint: BrowserPictureInPictureSnapPoint) => {
      activeSnapPointRef.current = nextSnapPoint;
      if (controlledSnapPoint === undefined) setLocalSnapPoint(nextSnapPoint);
      if (nextSnapPoint !== requestedSnapPoint)
        onSnapPointChange?.(nextSnapPoint);
    },
    [controlledSnapPoint, onSnapPointChange, requestedSnapPoint],
  );

  const resetToDefault = useCallback(() => {
    stopSnapAnimations();
    draggingRef.current = false;
    activeSnapPointRef.current = defaultSnapPoint;
    dragX.set(0);
    dragY.set(0);
    if (controlledSnapPoint === undefined) setLocalSnapPoint(defaultSnapPoint);
  }, [controlledSnapPoint, defaultSnapPoint, dragX, dragY, stopSnapAnimations]);

  useEffect(
    () => () => {
      stopSnapAnimations();
    },
    [stopSnapAnimations],
  );

  useLayoutEffect(() => {
    const previousMode = previousModeRef.current;
    previousModeRef.current = mode;
    if (mode === "picture-in-picture") {
      activeSnapPointRef.current =
        previousMode === "picture-in-picture"
          ? snapPoint
          : (controlledSnapPoint ?? defaultSnapPoint);
    }
  }, [controlledSnapPoint, defaultSnapPoint, mode, snapPoint]);

  useLayoutEffect(() => {
    const container = containerRef?.current;
    const frame = frameRef.current;
    const portalHost = portalHostRef.current;
    if (!portalHost) return;
    const contained =
      mode === "picture-in-picture" && Boolean(container && frame);
    portalHost.classList.toggle("bui-browser-portal--pip-contained", contained);
    if (!contained) {
      stopSnapAnimations();
      dragX.set(0);
      dragY.set(0);
      if (frame) {
        frame.style.removeProperty("--bui-pip-left");
        frame.style.removeProperty("--bui-pip-top");
        delete frame.dataset.pipDragging;
      }
      for (const property of portalProperties)
        portalHost.style.removeProperty(property);
      return;
    }
    if (!container || !frame) return;
    const updatePortalBounds = () => {
      const bounds = container.getBoundingClientRect();
      const obstacles = avoidRefs.flatMap((ref) => {
        const element = ref.current;
        return element ? [element.getBoundingClientRect()] : [];
      });
      const targetStyle = window.getComputedStyle(container);
      const left = Math.floor(bounds.left);
      const top = Math.floor(bounds.top);
      portalHost.style.left = `${left}px`;
      portalHost.style.top = `${top}px`;
      portalHost.style.width = `${Math.ceil(bounds.right) - left}px`;
      portalHost.style.height = `${Math.ceil(bounds.bottom) - top}px`;
      portalHost.style.borderRadius = targetStyle.borderRadius;
      if (!draggingRef.current) {
        setFramePosition(
          frame,
          pointPosition(
            activeSnapPointRef.current,
            bounds,
            layoutBounds(frame),
            inset,
            obstacles,
          ),
        );
      }
    };
    updatePortalBounds();
    const observer = new ResizeObserver(updatePortalBounds);
    observer.observe(container);
    observer.observe(frame);
    for (const ref of avoidRefs) {
      if (ref.current) observer.observe(ref.current);
    }
    window.addEventListener("resize", updatePortalBounds);
    window.addEventListener("scroll", updatePortalBounds, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePortalBounds);
      window.removeEventListener("scroll", updatePortalBounds, true);
    };
  }, [
    containerRef,
    frameMounted,
    frameRef,
    inset,
    mode,
    portalHostRef,
    snapPoint,
    avoidRefs,
    dragX,
    dragY,
    stopSnapAnimations,
  ]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (mode !== "picture-in-picture" || !draggable || event.button !== 0)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "button,a,input,textarea,select,[role='button'],[data-bui-no-drag]",
        )
      )
        return;
      stopSnapAnimations();
      dragControls.start(event, { distanceThreshold: 4 });
    },
    [dragControls, draggable, mode, stopSnapAnimations],
  );

  const onDragStart = useCallback(
    (event: MouseEvent | TouchEvent | PointerEvent) => {
      const frame = frameRef.current;
      if (!frame) return;
      cancelBrowserPointerInteraction(event, frame);
      draggingRef.current = true;
      frame.dataset.pipDragging = "true";
    },
    [frameRef],
  );

  const onDragEnd = useCallback(() => {
    const frame = frameRef.current;
    const portalHost = portalHostRef.current;
    if (!frame || !portalHost) return;
    const container = portalHost.getBoundingClientRect();
    const frameBounds = frame.getBoundingClientRect();
    const obstacles = avoidRefs.flatMap((ref) => {
      const element = ref.current;
      return element ? [element.getBoundingClientRect()] : [];
    });
    const currentPosition = {
      left: frameBounds.left - container.left,
      top: frameBounds.top - container.top,
    };
    const nextSnapPoint = nearestBrowserPictureInPictureSnapPoint(
      currentPosition,
      allowedSnapPoints,
      container,
      frameBounds,
      inset,
      obstacles,
    );
    const targetPosition = pointPosition(
      nextSnapPoint,
      container,
      frameBounds,
      inset,
      obstacles,
    );
    setFramePosition(frame, targetPosition);
    dragX.set(frameBounds.left - (container.left + targetPosition.left));
    dragY.set(frameBounds.top - (container.top + targetPosition.top));
    stopSnapAnimations();
    snapAnimationsRef.current = [
      animate(dragX, 0, snapTransition),
      animate(dragY, 0, snapTransition),
    ];
    commitSnapPoint(nextSnapPoint);
    draggingRef.current = false;
    delete frame.dataset.pipDragging;
  }, [
    allowedSnapPoints,
    avoidRefs,
    commitSnapPoint,
    dragX,
    dragY,
    frameRef,
    inset,
    portalHostRef,
    stopSnapAnimations,
  ]);

  return {
    dragControls,
    dragX,
    dragY,
    draggable: Boolean(options) && draggable,
    onDragEnd,
    onDragStart,
    onPointerDown,
    resetToDefault,
    snapPoint,
  };
}
