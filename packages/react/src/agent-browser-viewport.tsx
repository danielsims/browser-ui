"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { BrowserFrameMetadata, BrowserStreamMessage, BrowserViewportStatus } from "./protocol";
import { browserKeyboardInput } from "./protocol";

export interface AgentBrowserViewportProps {
  ariaLabel?: string;
  className?: string;
  interactive?: boolean;
  streamUrl: string;
  viewportSize?: BrowserViewportSize;
  onStatusChange?: (status: BrowserViewportStatus) => void;
  onUrlChange?: (url: string) => void;
  onViewportResize?: (width: number, height: number) => void;
}

export interface BrowserViewportSize {
  width: number;
  height: number;
}

interface ActivePointer {
  button: "left" | "middle" | "right";
  clickCount: number;
  modifiers: number;
  pointerId: number;
  x: number;
  y: number;
}

function modifiers(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0)
    | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
}

/** Interactive client for the official agent-browser WebSocket stream protocol. */
export function AgentBrowserViewport({
  ariaLabel = "Interactive browser",
  className,
  interactive = true,
  streamUrl,
  viewportSize,
  onStatusChange,
  onUrlChange,
  onViewportResize,
}: AgentBrowserViewportProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const metadataRef = useRef<BrowserFrameMetadata | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<Record<string, unknown> | null>(null);
  const wheelFrameRef = useRef<number | null>(null);
  const pendingWheelRef = useRef<{ deltaX: number; deltaY: number; modifiers: number; x: number; y: number } | null>(null);
  const activePointerRef = useRef<ActivePointer | null>(null);
  const statusChangeRef = useRef(onStatusChange);
  const urlChangeRef = useRef(onUrlChange);
  const viewportResizeRef = useRef(onViewportResize);
  statusChangeRef.current = onStatusChange;
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
    const scale = Math.min(rect.width / metadata.deviceWidth, rect.height / metadata.deviceHeight);
    const renderedWidth = metadata.deviceWidth * scale;
    const renderedHeight = metadata.deviceHeight * scale;
    const offsetX = (rect.width - renderedWidth) / 2;
    const offsetY = (rect.height - renderedHeight) / 2;
    return {
      x: Math.max(0, Math.min(metadata.deviceWidth, (clientX - rect.left - offsetX) / scale)),
      y: Math.max(0, Math.min(metadata.deviceHeight, (clientY - rect.top - offsetY) / scale)),
    };
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
    let closed = false; let decoding = false; let frameVersion = 0;
    let pendingFrame: Extract<BrowserStreamMessage, { type: "frame" }> | null = null;
    const drawLatestFrame = async () => {
      if (decoding || !pendingFrame) return;
      decoding = true;
      try {
        while (!closed && pendingFrame) {
          const message = pendingFrame; const version = frameVersion; pendingFrame = null;
          metadataRef.current = message.metadata;
          const binary = atob(message.data); const bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
          if (version === frameVersion) {
            const canvas = canvasRef.current;
            if (canvas) {
              if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
              if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
              canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
            }
          }
          bitmap.close();
        }
      } finally { decoding = false; if (!closed && pendingFrame) void drawLatestFrame(); }
    };
    let reconnectAttempt = 0; let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      statusChangeRef.current?.("connecting");
      const socket = new WebSocket(streamUrl); socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (closed || socketRef.current !== socket) return;
        reconnectAttempt = 0; releaseActivePointer(); statusChangeRef.current?.("connected");
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (closed) return;
        statusChangeRef.current?.("disconnected");
        reconnectTimer = setTimeout(connect, Math.min(2_000, 250 * 2 ** reconnectAttempt)); reconnectAttempt += 1;
      });
      socket.addEventListener("error", () => { if (!closed && socketRef.current === socket) { statusChangeRef.current?.("error"); socket.close(); } });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        let message: BrowserStreamMessage;
        try { message = JSON.parse(event.data) as BrowserStreamMessage; } catch { return; }
        if (message.type === "url") { urlChangeRef.current?.(message.url); return; }
        if (message.type === "cursor") { if (elementRef.current) elementRef.current.style.cursor = message.cursor; return; }
        if (message.type !== "frame") return;
        frameVersion += 1; pendingFrame = message; void drawLatestFrame();
      });
    };
    connect();
    return () => { closed = true; pendingFrame = null; releaseActivePointer(); if (moveFrameRef.current) cancelAnimationFrame(moveFrameRef.current); if (wheelFrameRef.current) cancelAnimationFrame(wheelFrameRef.current); if (reconnectTimer) clearTimeout(reconnectTimer); socketRef.current?.close(); socketRef.current = null; };
  }, [releaseActivePointer, streamUrl]);

  const viewportWidth = viewportSize?.width;
  const viewportHeight = viewportSize?.height;

  useEffect(() => {
    if (viewportWidth !== undefined && viewportHeight !== undefined) {
      viewportResizeRef.current?.(Math.max(320, Math.round(viewportWidth)), Math.max(240, Math.round(viewportHeight)));
      return;
    }
    const element = elementRef.current; if (!element) return;
    let last = "";
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const width = Math.round(entry.contentRect.width); const height = Math.round(entry.contentRect.height); const key = `${width}x${height}`;
      if (width < 1 || height < 1 || key === last) return;
      last = key; viewportResizeRef.current?.(width, height);
    });
    observer.observe(element); return () => observer.disconnect();
  }, [viewportHeight, viewportWidth]);

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (!interactive || document.activeElement !== elementRef.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "v") return;
      event.preventDefault(); event.stopPropagation();
      send(browserKeyboardInput(event, event.type === "keydown" ? "keyDown" : "keyUp"));
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (!interactive || document.activeElement !== elementRef.current) return;
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
  }, [interactive, releaseActivePointer, send]);

  useEffect(() => {
    if (interactive) return;
    releaseActivePointer();
    if (document.activeElement === elementRef.current) elementRef.current?.blur();
  }, [interactive, releaseActivePointer]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || !interactive) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const position = point(event.clientX, event.clientY);
      if (!position) return;
      const lineHeight = 16;
      const factor = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? lineHeight
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? element.clientHeight : 1;
      const pending = pendingWheelRef.current;
      pendingWheelRef.current = {
        ...position,
        deltaX: (pending?.deltaX ?? 0) + event.deltaX * factor,
        deltaY: (pending?.deltaY ?? 0) + event.deltaY * factor,
        modifiers: modifiers(event),
      };
      if (wheelFrameRef.current) return;
      wheelFrameRef.current = requestAnimationFrame(() => {
        wheelFrameRef.current = null;
        const wheel = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (wheel) send({ type: "input_mouse", eventType: "mouseWheel", ...wheel });
      });
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", handleWheel);
      if (wheelFrameRef.current) cancelAnimationFrame(wheelFrameRef.current);
      wheelFrameRef.current = null;
      pendingWheelRef.current = null;
    };
  }, [interactive, point, send]);

  const mouse = (eventType: "mouseMoved" | "mousePressed", event: ReactPointerEvent<HTMLDivElement>) => {
    const position = point(event.clientX, event.clientY); if (!position) return;
    const button: ActivePointer["button"] = event.button === 2 ? "right" : event.button === 1 ? "middle" : "left";
    const message = { type: "input_mouse", eventType, ...position, button, clickCount: event.detail || 1, modifiers: modifiers(event) };
    if (eventType === "mousePressed") {
      if (!releaseActivePointer()) return;
      const active = { button, clickCount: message.clickCount, modifiers: message.modifiers, pointerId: event.pointerId, x: message.x, y: message.y };
      if (send(message)) activePointerRef.current = active; return;
    }
    if (activePointerRef.current?.pointerId === event.pointerId) { activePointerRef.current.x = message.x; activePointerRef.current.y = message.y; }
    pendingMoveRef.current = message;
    if (moveFrameRef.current) return;
    moveFrameRef.current = requestAnimationFrame(() => { moveFrameRef.current = null; if (pendingMoveRef.current) send(pendingMoveRef.current); });
  };

  return <div ref={elementRef} role="application" tabIndex={interactive ? 0 : -1} aria-label={ariaLabel} aria-disabled={!interactive}
    className={["bui-agent-viewport", className].filter(Boolean).join(" ")}
    onContextMenu={(event) => event.preventDefault()}
    onPointerDown={(event) => { if (!interactive) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); mouse("mousePressed", event); }}
    onPointerMove={(event) => { if (interactive) mouse("mouseMoved", event); }}
    onPointerUp={(event) => { if (activePointerRef.current?.pointerId === event.pointerId) { const position = point(event.clientX, event.clientY); if (position) { activePointerRef.current.x = position.x; activePointerRef.current.y = position.y; } releaseActivePointer(); } if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={(event) => { releaseActivePointer(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onLostPointerCapture={releaseActivePointer}>
    <canvas ref={canvasRef} />
  </div>;
}
