import {
  type AgentBrowserIncomingMessage,
  type BrowserViewportSize,
  parseAgentBrowserMessage,
} from "@browser-ui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type AgentBrowserConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "paused"
  | "error";

export interface AgentBrowserReconnectOptions {
  /** Delay before the first retry. Defaults to 500ms. */
  initialDelayMs?: number;
  /** Maximum delay between retries. Defaults to 8 seconds. */
  maxDelayMs?: number;
  /** Number of retries after the initial connection. Defaults to 8. */
  maxAttempts?: number;
  /** An open socket must survive this long before the retry budget resets. */
  stableConnectionMs?: number;
}

export interface AgentBrowserFrame {
  data: string;
  message: AgentBrowserIncomingMessage;
  receivedAt: number;
  sequence: number;
  uri: string;
  viewportSize: BrowserViewportSize | null;
}

export interface UseAgentBrowserStreamOptions {
  enabled?: boolean;
  onError?: (error: Error) => void;
  onMessage?: (message: AgentBrowserIncomingMessage) => void;
  onStatusChange?: (
    status: AgentBrowserConnectionStatus,
    error: Error | null,
  ) => void;
  onUrlChange?: (url: string) => void;
  protocols?: string | string[];
  reconnect?: AgentBrowserReconnectOptions;
  streamUrl?: string | null;
}

export interface AgentBrowserStreamController {
  connectionStatus: AgentBrowserConnectionStatus;
  error: Error | null;
  frame: AgentBrowserFrame | null;
  isConnected: boolean;
  reconnect: () => void;
  remoteStatus: AgentBrowserIncomingMessage | null;
  remoteUrl: string | null;
  send: (message: unknown) => boolean;
  viewportSize: BrowserViewportSize | null;
}

interface CallbackRefs {
  onError: UseAgentBrowserStreamOptions["onError"];
  onMessage: UseAgentBrowserStreamOptions["onMessage"];
  onStatusChange: UseAgentBrowserStreamOptions["onStatusChange"];
  onUrlChange: UseAgentBrowserStreamOptions["onUrlChange"];
}

const defaultReconnect: Required<AgentBrowserReconnectOptions> = {
  initialDelayMs: 500,
  maxAttempts: 8,
  maxDelayMs: 8_000,
  stableConnectionMs: 10_000,
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function viewportFromMessage(
  message: AgentBrowserIncomingMessage,
  fallback: BrowserViewportSize | null,
): BrowserViewportSize | null {
  const record = asRecord(message);
  const metadata = asRecord(record?.metadata);
  const width =
    positiveNumber(metadata?.deviceWidth) ??
    positiveNumber(record?.viewportWidth) ??
    fallback?.width ??
    null;
  const height =
    positiveNumber(metadata?.deviceHeight) ??
    positiveNumber(record?.viewportHeight) ??
    fallback?.height ??
    null;
  return width !== null && height !== null ? { width, height } : null;
}

function isAppActive(status: AppStateStatus): boolean {
  return status !== "background" && status !== "inactive";
}

function errorFrom(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback);
}

/**
 * Owns one agent-browser-compatible WebSocket and keeps only the newest frame
 * received during a native render interval.
 */
export function useAgentBrowserStream({
  enabled = true,
  onError,
  onMessage,
  onStatusChange,
  onUrlChange,
  protocols,
  reconnect,
  streamUrl,
}: UseAgentBrowserStreamOptions): AgentBrowserStreamController {
  const [connectionStatus, setConnectionStatus] =
    useState<AgentBrowserConnectionStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [frame, setFrame] = useState<AgentBrowserFrame | null>(null);
  const [remoteStatus, setRemoteStatus] =
    useState<AgentBrowserIncomingMessage | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [viewportSize, setViewportSize] =
    useState<BrowserViewportSize | null>(null);
  const callbacksRef = useRef<CallbackRefs>({
    onError,
    onMessage,
    onStatusChange,
    onUrlChange,
  });
  const socketRef = useRef<WebSocket | null>(null);
  const statusRef = useRef<AgentBrowserConnectionStatus>("idle");
  const viewportRef = useRef<BrowserViewportSize | null>(null);
  const restartRef = useRef<() => void>(() => undefined);
  callbacksRef.current = { onError, onMessage, onStatusChange, onUrlChange };

  const protocolsKey = Array.isArray(protocols)
    ? JSON.stringify(protocols)
    : (protocols ?? "");
  const initialDelayMs = Math.max(
    0,
    reconnect?.initialDelayMs ?? defaultReconnect.initialDelayMs,
  );
  const maxAttempts = Math.max(
    0,
    Math.floor(reconnect?.maxAttempts ?? defaultReconnect.maxAttempts),
  );
  const maxDelayMs = Math.max(
    initialDelayMs,
    reconnect?.maxDelayMs ?? defaultReconnect.maxDelayMs,
  );
  const stableConnectionMs = Math.max(
    0,
    reconnect?.stableConnectionMs ?? defaultReconnect.stableConnectionMs,
  );

  const send = useCallback((message: unknown) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch (cause) {
      const nextError = errorFrom(cause, "Could not send browser input.");
      callbacksRef.current.onError?.(nextError);
      try {
        socket.close();
      } catch {
        // The reconnect path is already driven by the socket lifecycle.
      }
      return false;
    }
  }, []);

  const forceReconnect = useCallback(() => restartRef.current(), []);

  useEffect(() => {
    let disposed = false;
    let appActive = isAppActive(AppState.currentState);
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let stableTimer: ReturnType<typeof setTimeout> | null = null;
    let frameRequest: number | null = null;
    let pendingFrame: AgentBrowserFrame | null = null;
    let frameSequence = 0;
    const selectedProtocols = protocolsKey
      ? Array.isArray(protocols)
        ? (JSON.parse(protocolsKey) as string[])
        : protocolsKey
      : undefined;

    const updateStatus = (
      nextStatus: AgentBrowserConnectionStatus,
      nextError: Error | null = null,
    ) => {
      if (disposed) return;
      const changed = statusRef.current !== nextStatus || nextError !== null;
      statusRef.current = nextStatus;
      setConnectionStatus(nextStatus);
      setError(nextError);
      if (changed) {
        callbacksRef.current.onStatusChange?.(nextStatus, nextError);
      }
    };

    const reportError = (nextError: Error) => {
      callbacksRef.current.onError?.(nextError);
    };

    const clearTimers = () => {
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      if (stableTimer !== null) clearTimeout(stableTimer);
      reconnectTimer = null;
      stableTimer = null;
    };

    const closeCurrentSocket = () => {
      const socket = socketRef.current;
      socketRef.current = null;
      if (!socket) return;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // A half-created native socket can throw while being torn down.
      }
    };

    const flushFrame = () => {
      frameRequest = null;
      const nextFrame = pendingFrame;
      pendingFrame = null;
      if (!disposed && nextFrame) setFrame(nextFrame);
    };

    const queueFrame = (message: AgentBrowserIncomingMessage, data: string) => {
      const nextViewport = viewportFromMessage(message, viewportRef.current);
      if (nextViewport) {
        viewportRef.current = nextViewport;
        setViewportSize(nextViewport);
      }
      frameSequence += 1;
      pendingFrame = {
        data,
        message,
        receivedAt: Date.now(),
        sequence: frameSequence,
        uri: data.startsWith("data:")
          ? data
          : `data:image/jpeg;base64,${data}`,
        viewportSize: nextViewport,
      };
      if (frameRequest === null) {
        frameRequest = requestAnimationFrame(flushFrame);
      }
    };

    let connect = () => undefined;

    const scheduleReconnect = () => {
      if (disposed || !enabled || !streamUrl || !appActive) return;
      if (reconnectAttempts >= maxAttempts) {
        const exhausted = new Error(
          `Browser stream disconnected after ${maxAttempts} reconnect attempts.`,
        );
        updateStatus("error", exhausted);
        reportError(exhausted);
        return;
      }
      const delay = Math.min(
        maxDelayMs,
        initialDelayMs * 2 ** reconnectAttempts,
      );
      reconnectAttempts += 1;
      updateStatus("reconnecting");
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    connect = () => {
      if (disposed || !enabled || !streamUrl || !appActive) return;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      closeCurrentSocket();
      updateStatus(reconnectAttempts === 0 ? "connecting" : "reconnecting");

      let socket: WebSocket;
      try {
        socket = selectedProtocols
          ? new WebSocket(streamUrl, selectedProtocols)
          : new WebSocket(streamUrl);
      } catch (cause) {
        const nextError = errorFrom(cause, "Could not create browser stream.");
        reportError(nextError);
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) return;
        updateStatus("connected");
        if (stableTimer !== null) clearTimeout(stableTimer);
        stableTimer = setTimeout(() => {
          stableTimer = null;
          reconnectAttempts = 0;
        }, stableConnectionMs);
      };

      socket.onmessage = (event) => {
        if (
          disposed ||
          socketRef.current !== socket ||
          typeof event.data !== "string"
        ) {
          return;
        }
        let message: AgentBrowserIncomingMessage | null;
        try {
          message = parseAgentBrowserMessage(event.data);
        } catch {
          return;
        }
        if (!message) return;
        callbacksRef.current.onMessage?.(message);
        const record = asRecord(message);
        if (record?.type === "frame" && typeof record.data === "string") {
          queueFrame(message, record.data);
          return;
        }
        if (record?.type === "url" && typeof record.url === "string") {
          setRemoteUrl(record.url);
          callbacksRef.current.onUrlChange?.(record.url);
          return;
        }
        if (record?.type === "status") {
          const nextViewport = viewportFromMessage(message, viewportRef.current);
          if (nextViewport) {
            viewportRef.current = nextViewport;
            setViewportSize(nextViewport);
          }
          setRemoteStatus(message);
        }
      };

      socket.onerror = () => {
        if (disposed || socketRef.current !== socket) return;
        reportError(new Error("Browser stream WebSocket failed."));
        try {
          socket.close();
        } catch {
          scheduleReconnect();
        }
      };

      socket.onclose = () => {
        if (disposed || socketRef.current !== socket) return;
        socketRef.current = null;
        if (stableTimer !== null) clearTimeout(stableTimer);
        stableTimer = null;
        scheduleReconnect();
      };
    };

    const restart = () => {
      if (disposed) return;
      clearTimers();
      reconnectAttempts = 0;
      closeCurrentSocket();
      if (!enabled || !streamUrl) {
        updateStatus("idle");
      } else if (!appActive) {
        updateStatus("paused");
      } else {
        connect();
      }
    };
    restartRef.current = restart;

    setFrame(null);
    setRemoteStatus(null);
    setRemoteUrl(null);
    setViewportSize(null);
    viewportRef.current = null;

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        const nextActive = isAppActive(nextState);
        if (nextActive === appActive) return;
        appActive = nextActive;
        if (!appActive) {
          clearTimers();
          closeCurrentSocket();
          if (enabled && streamUrl) updateStatus("paused");
          return;
        }
        reconnectAttempts = 0;
        if (enabled && streamUrl) connect();
      },
    );

    if (!enabled || !streamUrl) updateStatus("idle");
    else if (!appActive) updateStatus("paused");
    else connect();

    return () => {
      disposed = true;
      appStateSubscription.remove();
      clearTimers();
      closeCurrentSocket();
      pendingFrame = null;
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      if (restartRef.current === restart) {
        restartRef.current = () => undefined;
      }
    };
  }, [
    enabled,
    initialDelayMs,
    maxAttempts,
    maxDelayMs,
    protocolsKey,
    stableConnectionMs,
    streamUrl,
  ]);

  return {
    connectionStatus,
    error,
    frame,
    isConnected: connectionStatus === "connected",
    reconnect: forceReconnect,
    remoteStatus,
    remoteUrl,
    send,
    viewportSize,
  };
}
