"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type {
  AgentBrowserFrameMetadata,
  BrowserAgentActivity,
  BrowserSessionAccess,
  BrowserViewportSize,
  BrowserViewportStatus,
} from "@browser-ui/core";
import {
  browserKeyboardInput,
  describeAgentBrowserCommand,
  mapContainedPointToViewport,
  parseAgentBrowserMessage,
  canSendBrowserInput,
} from "@browser-ui/core";
import { decodeBrowserSessionBinaryFrame, type BrowserSessionConnection } from "@browser-ui/core";

export type { BrowserViewportSize } from "@browser-ui/core";

export interface AgentBrowserViewportProps {
  ariaLabel?: string;
  className?: string;
  interactive?: boolean;
  /** Host-projected access state. The gateway remains the security boundary. */
  access?: BrowserSessionAccess;
  streamUrl?: string;
  /** Optional WebSocket subprotocols, commonly used for short-lived session tickets. */
  protocols?: string | string[];
  /** Advanced host hook for cookie, ticket, proxy, or test-specific sockets. */
  createWebSocket?: (streamUrl: string, protocols?: string | string[]) => WebSocket;
  /** Resolves a fresh one-time gateway ticket before every connection attempt. */
  resolveConnection?: () => Promise<Pick<BrowserSessionConnection, "url" | "protocols">>;
  viewportSize?: BrowserViewportSize;
  onStatusChange?: (status: BrowserViewportStatus) => void;
  /** Reports the current structured browser command without exposing command values. */
  onActivityChange?: (activity: BrowserAgentActivity | null) => void;
  /** Requests host-managed control when a viewer first interacts without a lease. */
  onInteractionIntent?: () => void | Promise<unknown>;
  onUrlChange?: (url: string) => void;
  onViewportResize?: (width: number, height: number) => void;
}

interface ActivePointer {
  button: "left" | "middle" | "right";
  clickCount: number;
  modifiers: number;
  pointerId: number;
  x: number;
  y: number;
}

interface TouchGesture {
  clickCount: number;
  lastX: number;
  lastY: number;
  modifiers: number;
  moved: boolean;
  pointerId: number;
  startClientX: number;
  startClientY: number;
}

interface PendingViewportFrame {
  data: string | ArrayBuffer;
  metadata: AgentBrowserFrameMetadata;
}

type PendingInteraction =
  | {
    kind: "click";
    input: {
      button: ActivePointer["button"];
      clickCount: number;
      modifiers: number;
      x: number;
      y: number;
    };
  }
  | {
    kind: "wheel";
    input: {
      deltaX: number;
      deltaY: number;
      modifiers: number;
      x: number;
      y: number;
    };
  };

type LegacyWheelEvent = WheelEvent & {
  wheelDelta?: number;
  wheelDeltaX?: number;
  wheelDeltaY?: number;
};

function modifiers(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0)
    | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

function wheelDeltas(event: LegacyWheelEvent, pageHeight: number) {
  const legacy = event.type === "mousewheel";
  const rawX = legacy ? -(event.wheelDeltaX ?? 0) : event.deltaX;
  const rawY = legacy
    ? -(event.wheelDeltaY ?? event.wheelDelta ?? 0)
    : event.deltaY;
  const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? pageHeight : 1;
  return { deltaX: rawX * factor, deltaY: rawY * factor };
}

/** View-only by default client for the official agent-browser WebSocket stream protocol. */
export function AgentBrowserViewport({
  ariaLabel = "Live browser",
  className,
  interactive = false,
  access,
  streamUrl,
  protocols,
  createWebSocket,
  resolveConnection,
  viewportSize,
  onStatusChange,
  onActivityChange,
  onInteractionIntent,
  onUrlChange,
  onViewportResize,
}: AgentBrowserViewportProps) {
  const inputEnabled = interactive && (!access || canSendBrowserInput(access));
  const interactionIntentEnabled =
    !inputEnabled && onInteractionIntent !== undefined;
  const elementRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metadataRef = useRef<AgentBrowserFrameMetadata | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<Record<string, unknown> | null>(null);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const touchGestureRef = useRef<TouchGesture | null>(null);
  const interactiveRef = useRef(inputEnabled);
  const interactionIntentRef = useRef(onInteractionIntent);
  const interactionIntentPendingRef = useRef(false);
  const pendingInteractionRef = useRef<PendingInteraction | null>(null);
  const statusChangeRef = useRef(onStatusChange);
  const activityChangeRef = useRef(onActivityChange);
  const activityIdRef = useRef<string | null>(null);
  const urlChangeRef = useRef(onUrlChange);
  const viewportResizeRef = useRef(onViewportResize);
  interactionIntentRef.current = onInteractionIntent;
  statusChangeRef.current = onStatusChange;
  activityChangeRef.current = onActivityChange;
  urlChangeRef.current = onUrlChange;
  viewportResizeRef.current = onViewportResize;

  const send = useCallback((message: unknown) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    try { socket.send(JSON.stringify(message)); return true; }
    catch { socket.close(); return false; }
  }, []);

  const point = useCallback((clientX: number, clientY: number) => {
    const element = elementRef.current; const metadata = metadataRef.current;
    if (!element || !metadata) return null;
    const rect = element.getBoundingClientRect();
    return mapContainedPointToViewport(
      { x: clientX - rect.left, y: clientY - rect.top },
      { width: rect.width, height: rect.height },
      { width: metadata.deviceWidth, height: metadata.deviceHeight },
    );
  }, []);

  const requestInteractionControl = useCallback(() => {
    if (interactionIntentPendingRef.current) return;
    const request = interactionIntentRef.current;
    if (!request) return;
    interactionIntentPendingRef.current = true;
    let result: void | Promise<unknown>;
    try {
      result = request();
    } catch {
      pendingInteractionRef.current = null;
      interactionIntentPendingRef.current = false;
      return;
    }
    void Promise.resolve(result)
      .catch(() => {
        pendingInteractionRef.current = null;
      })
      .finally(() => {
        if (!interactiveRef.current) {
          interactionIntentPendingRef.current = false;
        }
      });
  }, []);

  const releaseActivePointer = useCallback(() => {
    const active = activePointerRef.current;
    if (!active) return true;
    const released = send({ type: "input_mouse", eventType: "mouseReleased", x: active.x, y: active.y,
      button: active.button, clickCount: active.clickCount, modifiers: active.modifiers });
    if (released) activePointerRef.current = null;
    return released;
  }, [send]);

  useEffect(() => {
    let closed = false; let decoding = false;
    let pendingFrame: PendingViewportFrame | null = null;
    let sourceEpoch: string | null = null;
    let lastRemoteFrameSequence = -1;
    const drawLatestFrame = async () => {
      if (decoding || !pendingFrame) return;
      decoding = true;
      try {
        while (!closed && pendingFrame) {
          const message = pendingFrame; pendingFrame = null;
          let bitmap: ImageBitmap | undefined;
          try {
            const jpeg = typeof message.data === "string"
              ? decodeBase64(message.data).buffer
              : message.data;
            bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
            if (closed) break;
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
              canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
              metadataRef.current = message.metadata;
              reconnectAttempt = 0;
              statusChangeRef.current?.("connected");
            }
          } catch {
            // Keep the last valid frame. A malformed frame must not kill the stream.
          } finally {
            bitmap?.close();
          }
        }
      } finally { decoding = false; if (!closed && pendingFrame) void drawLatestFrame(); }
    };
    let reconnectAttempt = 0; let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const stopHeartbeat = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = undefined;
    };
    const scheduleReconnect = () => {
      if (closed) return;
      if (activityIdRef.current) {
        activityIdRef.current = null;
        activityChangeRef.current?.(null);
      }
      statusChangeRef.current?.("disconnected");
      if (reconnectAttempt >= 8) {
        statusChangeRef.current?.("error");
        return;
      }
      reconnectTimer = setTimeout(
        () => void connect(),
        Math.min(2_000, 250 * 2 ** reconnectAttempt),
      );
      reconnectAttempt += 1;
    };
    const connect = async () => {
      if (closed) return;
      statusChangeRef.current?.("connecting");
      let socket: WebSocket;
      let browserSessionSocket = false;
      try {
        const resolved = resolveConnection ? await resolveConnection() : null;
        if (closed) return;
        const nextStreamUrl = resolved?.url ?? streamUrl;
        const nextProtocols = resolved?.protocols ?? protocols;
        if (!nextStreamUrl) throw new Error("A browser stream URL is required.");
        const socketProtocols = typeof nextProtocols === "string"
          ? nextProtocols
          : nextProtocols ? [...nextProtocols] : undefined;
        browserSessionSocket = typeof nextProtocols === "string"
          ? nextProtocols === "browser-session.v1"
          : nextProtocols?.includes("browser-session.v1") === true;
        socket = createWebSocket
          ? createWebSocket(nextStreamUrl, socketProtocols)
          : socketProtocols
            ? new WebSocket(nextStreamUrl, socketProtocols)
            : new WebSocket(nextStreamUrl);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (closed || socketRef.current !== socket) return;
        releaseActivePointer();
        stopHeartbeat();
        if (browserSessionSocket) {
          heartbeatTimer = setInterval(() => {
            if (socketRef.current === socket && socket.readyState === WebSocket.OPEN) {
              send({ v: 1, type: "heartbeat", sentAt: Date.now() });
            }
          }, 5_000);
        }
      });
      socket.addEventListener("close", () => {
        stopHeartbeat();
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        scheduleReconnect();
      });
      socket.addEventListener("error", () => { if (!closed && socketRef.current === socket) { statusChangeRef.current?.("error"); socket.close(); } });
      socket.addEventListener("message", (event) => {
        if (event.data instanceof ArrayBuffer) {
          const decoded = decodeBrowserSessionBinaryFrame(event.data);
          if (!decoded) return;
          if (
            decoded.header.sourceEpoch === sourceEpoch &&
            decoded.header.frameSequence <= lastRemoteFrameSequence
          ) return;
          if (decoded.header.sourceEpoch !== sourceEpoch) {
            sourceEpoch = decoded.header.sourceEpoch;
            lastRemoteFrameSequence = -1;
          }
          lastRemoteFrameSequence = decoded.header.frameSequence;
          pendingFrame = {
            data: event.data.slice(
              decoded.jpeg.byteOffset,
              decoded.jpeg.byteOffset + decoded.jpeg.byteLength,
            ),
            metadata: decoded.header.metadata,
          };
          void drawLatestFrame();
          return;
        }
        if (typeof event.data !== "string") return;
        const message = parseAgentBrowserMessage(event.data);
        if (!message) return;
        if (message.type === "url") { urlChangeRef.current?.(message.url); return; }
        if (message.type === "cursor") { if (elementRef.current) elementRef.current.style.cursor = message.cursor; return; }
        if (message.type === "command") {
          activityIdRef.current = message.id;
          activityChangeRef.current?.({
            id: message.id,
            action: message.action,
            label: describeAgentBrowserCommand(message.action, message.params),
            phase: "started",
            timestamp: message.timestamp,
          });
          return;
        }
        if (message.type === "result") {
          if (activityIdRef.current === message.id) {
            activityIdRef.current = null;
            activityChangeRef.current?.(null);
          }
          return;
        }
        if (message.type === "activity") {
          if (message.phase === "started") {
            activityIdRef.current = message.id;
            activityChangeRef.current?.(message);
          } else if (activityIdRef.current === message.id) {
            activityIdRef.current = null;
            activityChangeRef.current?.(null);
          }
          return;
        }
        if (message.type === "status") {
          if (message.connected && message.screencasting) {
            reconnectAttempt = 0;
            statusChangeRef.current?.("connected");
          } else if (message.connected) statusChangeRef.current?.("connecting");
          else {
            if (activityIdRef.current) {
              activityIdRef.current = null;
              activityChangeRef.current?.(null);
            }
            statusChangeRef.current?.("disconnected");
          }
          return;
        }
        if (message.type === "error") { statusChangeRef.current?.("error"); return; }
        if (message.type !== "frame") return;
        pendingFrame = message; void drawLatestFrame();
      });
    };
    void connect();
    return () => { closed = true; pendingFrame = null; touchGestureRef.current = null; releaseActivePointer(); if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current); if (reconnectTimer) clearTimeout(reconnectTimer); stopHeartbeat(); socketRef.current?.close(); socketRef.current = null; };
  }, [createWebSocket, protocols, releaseActivePointer, resolveConnection, streamUrl]);

  const reportsViewportResize = onViewportResize !== undefined;

  useEffect(() => {
    if (!reportsViewportResize) return;
    const element = elementRef.current; if (!element) return;
    let last = "";
    let pending: { height: number; key: string; width: number } | null = null;
    let reportFrame: number | null = null;
    const reportSize = (width: number, height: number) => {
      const nextWidth = Math.max(320, Math.round(width));
      const nextHeight = Math.max(240, Math.round(height));
      const key = `${nextWidth}x${nextHeight}`;
      if (key === last || key === pending?.key) return;
      pending = { height: nextHeight, key, width: nextWidth };
      if (reportFrame !== null) return;
      reportFrame = requestAnimationFrame(() => {
        reportFrame = null;
        const next = pending;
        pending = null;
        if (!next) return;
        last = next.key;
        viewportResizeRef.current?.(next.width, next.height);
      });
    };
    if (viewportSize) {
      reportSize(viewportSize.width, viewportSize.height);
      return () => {
        if (reportFrame !== null) cancelAnimationFrame(reportFrame);
      };
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      if (entry.contentRect.width < 1 || entry.contentRect.height < 1) return;
      reportSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    const bounds = element.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) {
      reportSize(bounds.width, bounds.height);
    }
    return () => {
      observer.disconnect();
      if (reportFrame !== null) cancelAnimationFrame(reportFrame);
    };
  }, [reportsViewportResize, viewportSize?.height, viewportSize?.width]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!inputEnabled || document.activeElement !== elementRef.current) return;
      if (event.key === "Escape" && elementRef.current?.closest("[data-mode]:not([data-mode='inline'])")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") return;
      event.preventDefault(); event.stopPropagation();
      send(browserKeyboardInput(event, event.type === "keydown" ? "keyDown" : "keyUp"));
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (!inputEnabled || document.activeElement !== elementRef.current) return;
      const text = event.clipboardData?.getData("text/plain"); if (!text) return;
      event.preventDefault(); event.stopPropagation();
      for (const character of text) {
        const input = { altKey: false, code: "", ctrlKey: false, key: character, metaKey: false, shiftKey: false };
        send(browserKeyboardInput(input, "keyDown")); send(browserKeyboardInput(input, "keyUp"));
      }
    };
    const releasePointer = () => releaseActivePointer();
    const releasePointerWhenHidden = () => { if (document.visibilityState === "hidden") releaseActivePointer(); };
    window.addEventListener("keydown", handleKeyboard, true); window.addEventListener("keyup", handleKeyboard, true);
    window.addEventListener("paste", handlePaste, true); window.addEventListener("blur", releasePointer, true);
    document.addEventListener("visibilitychange", releasePointerWhenHidden);
    return () => { releaseActivePointer(); window.removeEventListener("keydown", handleKeyboard, true); window.removeEventListener("keyup", handleKeyboard, true); window.removeEventListener("paste", handlePaste, true); window.removeEventListener("blur", releasePointer, true); document.removeEventListener("visibilitychange", releasePointerWhenHidden); };
  }, [inputEnabled, releaseActivePointer, send]);

  useEffect(() => {
    if (inputEnabled) return;
    touchGestureRef.current = null;
    releaseActivePointer();
    if (document.activeElement === elementRef.current) elementRef.current?.blur();
  }, [inputEnabled, releaseActivePointer]);

  useEffect(() => {
    const becameInteractive = inputEnabled && !interactiveRef.current;
    interactiveRef.current = inputEnabled;
    if (becameInteractive) elementRef.current?.focus({ preventScroll: true });
  }, [inputEnabled]);

  useEffect(() => {
    if (!inputEnabled) return;
    interactionIntentPendingRef.current = false;
    const pending = pendingInteractionRef.current;
    pendingInteractionRef.current = null;
    if (!pending) return;
    if (pending.kind === "click") {
      send({ type: "input_mouse", eventType: "mouseMoved", ...pending.input });
      send({ type: "input_mouse", eventType: "mousePressed", ...pending.input });
      send({ type: "input_mouse", eventType: "mouseReleased", ...pending.input });
      return;
    }
    send({ type: "input_mouse", eventType: "mouseWheel", ...pending.input });
  }, [inputEnabled, send]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || (!inputEnabled && !interactionIntentEnabled)) return;
    let lastStandardWheelAt = Number.NEGATIVE_INFINITY;
    let wheelFrame: number | null = null;
    let schedulingWheelFrame = false;
    let pendingWheelInput: PendingInteraction & { kind: "wheel" } | null = null;
    const scheduleWheelFlush = () => {
      if (wheelFrame !== null || schedulingWheelFrame) return;
      schedulingWheelFrame = true;
      const frame = requestAnimationFrame(() => {
        schedulingWheelFrame = false;
        wheelFrame = null;
        const pending = pendingWheelInput;
        pendingWheelInput = null;
        if (!pending) return;
        send({ type: "input_mouse", eventType: "mouseWheel", ...pending.input });
        scheduleWheelFlush();
      });
      if (schedulingWheelFrame) wheelFrame = frame;
    };
    const sendWheelInput = (input: PendingInteraction & { kind: "wheel" }) => {
      if (wheelFrame === null && !schedulingWheelFrame) {
        send({ type: "input_mouse", eventType: "mouseWheel", ...input.input });
        scheduleWheelFlush();
        return;
      }
      if (pendingWheelInput) {
        pendingWheelInput.input = {
          ...input.input,
          deltaX: pendingWheelInput.input.deltaX + input.input.deltaX,
          deltaY: pendingWheelInput.input.deltaY + input.input.deltaY,
        };
      } else {
        pendingWheelInput = input;
      }
    };
    const handleWheel = (rawEvent: Event) => {
      const event = rawEvent as LegacyWheelEvent;
      if (
        event.type === "mousewheel" &&
        performance.now() - lastStandardWheelAt < 12
      ) {
        return;
      }
      if (event.type === "wheel") {
        lastStandardWheelAt = performance.now();
      }
      const eventTarget =
        event.target instanceof Node && element.contains(event.target);
      const hitTarget = document
        .elementsFromPoint(event.clientX, event.clientY)
        .some((candidate) => candidate === element || element.contains(candidate));
      if (!eventTarget && !hitTarget) return;
      const position = point(event.clientX, event.clientY);
      if (!position) return;
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const deltas = wheelDeltas(event, bounds.height);
      const metadata = metadataRef.current;
      if (!metadata) return;
      const scale = Math.min(
        bounds.width / metadata.deviceWidth,
        bounds.height / metadata.deviceHeight,
      );
      if (!Number.isFinite(scale) || scale <= 0) return;
      const input = {
        ...position,
        deltaX: deltas.deltaX / scale,
        deltaY: deltas.deltaY / scale,
        modifiers: modifiers(event),
      };
      if (inputEnabled) {
        sendWheelInput({ kind: "wheel", input });
        return;
      }
      const pending = pendingInteractionRef.current;
      if (pending?.kind === "wheel") {
        pending.input = {
          ...input,
          deltaX: pending.input.deltaX + input.deltaX,
          deltaY: pending.input.deltaY + input.deltaY,
        };
      } else if (!pending) {
        pendingInteractionRef.current = { kind: "wheel", input };
      }
      requestInteractionControl();
    };
    window.addEventListener("wheel", handleWheel, {
      capture: true,
      passive: false,
    });
    window.addEventListener("mousewheel", handleWheel, {
      capture: true,
      passive: false,
    });
    return () => {
      if (wheelFrame !== null) cancelAnimationFrame(wheelFrame);
      window.removeEventListener("wheel", handleWheel, { capture: true });
      window.removeEventListener("mousewheel", handleWheel, { capture: true });
    };
  }, [inputEnabled, interactionIntentEnabled, point, requestInteractionControl, send]);

  const mouse = (eventType: "mouseMoved" | "mousePressed", event: ReactPointerEvent<HTMLDivElement>) => {
    const position = point(event.clientX, event.clientY); if (!position) return;
    const pressedButton: ActivePointer["button"] = event.button === 2
      ? "right"
      : event.button === 1 ? "middle" : "left";
    const button = eventType === "mouseMoved" && !activePointerRef.current
      ? "none"
      : pressedButton;
    const message = { type: "input_mouse", eventType, ...position, button, clickCount: event.detail || 1, modifiers: modifiers(event) };
    if (eventType === "mousePressed") {
      if (!releaseActivePointer()) return;
      const active = { button: pressedButton, clickCount: message.clickCount, modifiers: message.modifiers, pointerId: event.pointerId, x: message.x, y: message.y };
      if (send(message)) activePointerRef.current = active; return;
    }
    if (activePointerRef.current?.pointerId === event.pointerId) { activePointerRef.current.x = message.x; activePointerRef.current.y = message.y; }
    pendingMoveRef.current = message;
    if (moveFrameRef.current) return;
    moveFrameRef.current = requestAnimationFrame(() => { moveFrameRef.current = null; if (pendingMoveRef.current) send(pendingMoveRef.current); });
  };

  const beginTouch = (event: ReactPointerEvent<HTMLDivElement>) => {
    const position = point(event.clientX, event.clientY);
    if (!position) return;
    releaseActivePointer();
    touchGestureRef.current = {
      clickCount: event.detail || 1,
      lastX: position.x,
      lastY: position.y,
      modifiers: modifiers(event),
      moved: false,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
    };
  };

  const moveTouch = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const position = point(event.clientX, event.clientY);
    if (!position) return;
    if (!gesture.moved && Math.hypot(
      event.clientX - gesture.startClientX,
      event.clientY - gesture.startClientY,
    ) >= 6) gesture.moved = true;
    if (gesture.moved) {
      send({
        type: "input_mouse",
        eventType: "mouseWheel",
        deltaX: gesture.lastX - position.x,
        deltaY: gesture.lastY - position.y,
        modifiers: gesture.modifiers,
        x: position.x,
        y: position.y,
      });
    }
    gesture.lastX = position.x;
    gesture.lastY = position.y;
  };

  const endTouch = (event: ReactPointerEvent<HTMLDivElement>, cancelled = false) => {
    const gesture = touchGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    touchGestureRef.current = null;
    if (cancelled || gesture.moved) return;
    const position = point(event.clientX, event.clientY);
    if (!position) return;
    const input = {
      button: "left",
      clickCount: gesture.clickCount,
      modifiers: gesture.modifiers,
      ...position,
    };
    send({ type: "input_mouse", eventType: "mouseMoved", ...input });
    send({ type: "input_mouse", eventType: "mousePressed", ...input });
    send({ type: "input_mouse", eventType: "mouseReleased", ...input });
  };

  return <div ref={elementRef} role="application" tabIndex={inputEnabled || interactionIntentEnabled ? 0 : -1} aria-label={ariaLabel} aria-disabled={!inputEnabled}
    data-input-intent={interactionIntentEnabled ? "true" : undefined}
    className={["bui-agent-viewport", className].filter(Boolean).join(" ")}
    onContextMenu={(event) => event.preventDefault()}
    onKeyDown={(event) => {
      if (!interactionIntentEnabled || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      event.stopPropagation();
      requestInteractionControl();
    }}
    onPointerDown={(event) => {
      if (!inputEnabled) {
        if (interactionIntentEnabled) {
          event.preventDefault();
          event.stopPropagation();
          const position = point(event.clientX, event.clientY);
          if (position && !pendingInteractionRef.current) {
            pendingInteractionRef.current = {
              kind: "click",
              input: {
                ...position,
                button: event.button === 2
                  ? "right"
                  : event.button === 1 ? "middle" : "left",
                clickCount: event.detail || 1,
                modifiers: modifiers(event),
              },
            };
          }
          requestInteractionControl();
        }
        return;
      }
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      if (event.pointerType === "touch") beginTouch(event);
      else mouse("mousePressed", event);
    }}
    onPointerMove={(event) => {
      if (!inputEnabled) return;
      if (event.pointerType === "touch") moveTouch(event);
      else mouse("mouseMoved", event);
    }}
    onPointerUp={(event) => {
      if (event.pointerType === "touch") endTouch(event);
      else if (activePointerRef.current?.pointerId === event.pointerId) {
        const position = point(event.clientX, event.clientY);
        if (position) {
          activePointerRef.current.x = position.x;
          activePointerRef.current.y = position.y;
        }
        releaseActivePointer();
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={(event) => {
      if (event.pointerType === "touch") endTouch(event, true);
      else releaseActivePointer();
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onLostPointerCapture={() => {
      touchGestureRef.current = null;
      releaseActivePointer();
    }}>
    <canvas ref={canvasRef} />
  </div>;
}

function decodeBase64(encoded: string): Uint8Array<ArrayBuffer> {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
