import { randomUUID } from "node:crypto";
import {
  BROWSER_SESSION_VERSION,
  encodeBrowserSessionBinaryFrame,
  normalizeGatewayOrigin,
  parseAgentBrowserMessage,
  parseBrowserSourceInputMessage,
  type BrowserSessionBinaryFrameHeader,
  type BrowserSessionConnection,
  type BrowserSessionDescriptor,
  type BrowserSessionHttpAuthorization,
} from "@browser-ui/core";
import WebSocket, { type RawData } from "ws";

export interface AgentBrowserSourceOptions {
  gatewayOrigin: string;
  streamUrl?: string;
  /** Resolves the current loopback stream URL before each connection attempt. */
  resolveStreamUrl?: () => string | Promise<string>;
  title: string;
  viewport: { width: number; height: number };
  authorize?: BrowserSessionHttpAuthorization;
  fetch?: typeof globalThis.fetch;
  reconnectInitialDelayMs?: number;
  reconnectMaximumDelayMs?: number;
  maximumBufferedBytes?: number;
  navigate?: (direction: "back" | "forward") => Promise<void>;
}

export interface AgentBrowserSourceMetrics {
  localFramesReceived: number;
  jpegBytesReceived: number;
  framesPublished: number;
  framesDropped: number;
  gatewayReconnects: number;
  localReconnects: number;
  lastPublishLatencyMs: number;
  maximumPublishLatencyMs: number;
}

export interface AgentBrowserSourceHandle {
  session: BrowserSessionDescriptor;
  getMetrics(): AgentBrowserSourceMetrics;
  close(): Promise<void>;
}

interface PendingFrame {
  capturedAt: number;
  payload: Uint8Array;
}

export async function relayAgentBrowserSession(
  options: AgentBrowserSourceOptions,
): Promise<AgentBrowserSourceHandle> {
  const gatewayOrigin = normalizeGatewayOrigin(options.gatewayOrigin);
  const staticStreamUrl = options.streamUrl
    ? validateLoopbackStreamUrl(options.streamUrl)
    : null;
  if (!staticStreamUrl && !options.resolveStreamUrl) {
    throw new Error("An agent-browser stream URL or resolver is required.");
  }
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) throw new Error("A fetch implementation is required.");
  const maximumBufferedBytes = options.maximumBufferedBytes ?? 0;
  const reconnectInitialDelayMs = options.reconnectInitialDelayMs ?? 250;
  const reconnectMaximumDelayMs = options.reconnectMaximumDelayMs ?? 5_000;
  const metrics: AgentBrowserSourceMetrics = {
    localFramesReceived: 0,
    jpegBytesReceived: 0,
    framesPublished: 0,
    framesDropped: 0,
    gatewayReconnects: 0,
    localReconnects: 0,
    lastPublishLatencyMs: 0,
    maximumPublishLatencyMs: 0,
  };
  let closed = false;
  let gatewaySocket: WebSocket | null = null;
  let localSocket: WebSocket | null = null;
  let gatewayAttempt = 0;
  let localAttempt = 0;
  let gatewayTimer: ReturnType<typeof setTimeout> | null = null;
  let localTimer: ReturnType<typeof setTimeout> | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let resolvingLocal = false;
  let sendingFrame = false;
  let pendingFrame: PendingFrame | null = null;
  let sourceFrameSequence = 0;
  let navigationQueue = Promise.resolve();
  const sourceEpoch = randomUUID();

  const created = await requestJson<{
    session: BrowserSessionDescriptor;
    sourceConnection: BrowserSessionConnection;
  }>(new URL("/v1/sessions", gatewayOrigin).toString(), {
    title: options.title,
    viewport: options.viewport,
  });

  const scheduleGatewayReconnect = () => {
    if (closed || gatewayTimer) return;
    const delay = reconnectDelay(gatewayAttempt++, reconnectInitialDelayMs, reconnectMaximumDelayMs);
    metrics.gatewayReconnects += 1;
    gatewayTimer = setTimeout(() => {
      gatewayTimer = null;
      void refreshGatewayConnection().catch(scheduleGatewayReconnect);
    }, delay);
  };

  const scheduleLocalReconnect = () => {
    if (closed || localTimer || gatewaySocket?.readyState !== WebSocket.OPEN) return;
    const delay = reconnectDelay(localAttempt++, reconnectInitialDelayMs, reconnectMaximumDelayMs);
    metrics.localReconnects += 1;
    localTimer = setTimeout(() => {
      localTimer = null;
      connectLocal();
    }, delay);
  };

  const closeLocal = () => {
    const socket = localSocket;
    localSocket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, "Gateway unavailable");
  };

  const sendState = (status: "waiting" | "live" | "offline", viewport = options.viewport) => {
    if (gatewaySocket?.readyState !== WebSocket.OPEN) return;
    gatewaySocket.send(JSON.stringify({
      v: BROWSER_SESSION_VERSION,
      type: "source.state",
      status,
      viewport,
    }));
  };

  const flushLatestFrame = () => {
    if (
      closed ||
      sendingFrame ||
      !pendingFrame ||
      gatewaySocket?.readyState !== WebSocket.OPEN
    ) return;
    if (gatewaySocket.bufferedAmount > maximumBufferedBytes) {
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushLatestFrame();
        }, 8);
      }
      return;
    }
    const frame = pendingFrame;
    pendingFrame = null;
    sendingFrame = true;
    gatewaySocket.send(frame.payload, { binary: true, compress: false }, (error) => {
      sendingFrame = false;
      if (error) gatewaySocket?.close();
      else {
        const latency = Math.max(0, Date.now() - frame.capturedAt);
        metrics.framesPublished += 1;
        metrics.lastPublishLatencyMs = latency;
        metrics.maximumPublishLatencyMs = Math.max(metrics.maximumPublishLatencyMs, latency);
        flushLatestFrame();
      }
    });
  };

  const queueFrame = (payload: Uint8Array, capturedAt: number) => {
    if (pendingFrame) metrics.framesDropped += 1;
    pendingFrame = { capturedAt, payload };
    flushLatestFrame();
  };

  const handleLocalMessage = (data: RawData, isBinary: boolean) => {
    if (isBinary) return;
    const message = parseAgentBrowserMessage(rawText(data));
    if (!message) return;
    if (message.type === "frame") {
      const jpeg = decodeJpeg(message.data);
      if (!jpeg) return;
      const capturedAt = Date.now();
      sourceFrameSequence += 1;
      const header: BrowserSessionBinaryFrameHeader = {
        v: BROWSER_SESSION_VERSION,
        type: "frame",
        codec: "image/jpeg",
        width: message.metadata.deviceWidth,
        height: message.metadata.deviceHeight,
        capturedAt,
        sourceEpoch,
        frameSequence: sourceFrameSequence,
        viewportRevision: 0,
        metadata: message.metadata,
      };
      metrics.localFramesReceived += 1;
      metrics.jpegBytesReceived += jpeg.byteLength;
      queueFrame(encodeBrowserSessionBinaryFrame(header, jpeg), capturedAt);
      return;
    }
    if (message.type === "status") {
      sendState(
        message.connected && message.screencasting
          ? "live"
          : message.connected ? "waiting" : "offline",
        { width: message.viewportWidth, height: message.viewportHeight },
      );
      return;
    }
    if (message.type === "url" && gatewaySocket?.readyState === WebSocket.OPEN) {
      gatewaySocket.send(JSON.stringify({
        v: BROWSER_SESSION_VERSION,
        type: "source.page",
        url: message.url,
      }));
    }
  };

  const connectLocal = async () => {
    if (
      closed ||
      localSocket ||
      resolvingLocal ||
      gatewaySocket?.readyState !== WebSocket.OPEN
    ) return;
    resolvingLocal = true;
    let streamUrl: string;
    try {
      const resolved = options.resolveStreamUrl
        ? await options.resolveStreamUrl()
        : staticStreamUrl;
      if (!resolved) throw new Error("The agent-browser stream URL resolver returned no URL.");
      streamUrl = validateLoopbackStreamUrl(resolved);
    } catch {
      resolvingLocal = false;
      scheduleLocalReconnect();
      return;
    }
    resolvingLocal = false;
    if (closed || localSocket || gatewaySocket?.readyState !== WebSocket.OPEN) return;
    const socket = new WebSocket(streamUrl, { perMessageDeflate: false });
    localSocket = socket;
    socket.on("open", () => {
      if (socket !== localSocket) return;
      localAttempt = 0;
      sendState("waiting");
    });
    socket.on("message", handleLocalMessage);
    socket.on("close", () => {
      if (socket !== localSocket) return;
      localSocket = null;
      sendState("offline");
      scheduleLocalReconnect();
    });
    socket.on("error", () => socket.close());
  };

  const connectGateway = (connection: BrowserSessionConnection) => new Promise<void>((resolve, reject) => {
    if (closed) return reject(new Error("Source adapter is closed."));
    const socket = new WebSocket(connection.url, [...connection.protocols], {
      perMessageDeflate: false,
    });
    const failBeforeOpen = (error: Error) => {
      socket.removeListener("open", opened);
      reject(error);
    };
    const opened = () => {
      socket.removeListener("error", failBeforeOpen);
      if (closed) {
        socket.close();
        reject(new Error("Source adapter is closed."));
        return;
      }
      gatewaySocket = socket;
      gatewayAttempt = 0;
      void connectLocal();
      flushLatestFrame();
      resolve();
    };
    socket.once("open", opened);
    socket.once("error", failBeforeOpen);
    socket.on("message", (data, isBinary) => {
      if (isBinary || socket !== gatewaySocket) return;
      const message = parseBrowserSourceInputMessage(rawText(data));
      if (
        !message ||
        Date.parse(message.expiresAt) <= Date.now()
      ) return;
      if (message.input.type === "input_navigation") {
        const direction = message.input.direction;
        if (options.navigate) {
          navigationQueue = navigationQueue
            .then(() => options.navigate!(direction))
            .catch(() => undefined);
        }
        return;
      }
      if (localSocket?.readyState !== WebSocket.OPEN) return;
      localSocket.send(JSON.stringify(message.input));
    });
    socket.on("close", () => {
      if (socket !== gatewaySocket) return;
      gatewaySocket = null;
      sendingFrame = false;
      closeLocal();
      scheduleGatewayReconnect();
    });
    socket.on("error", () => socket.close());
  });

  async function refreshGatewayConnection() {
    const refreshed = await requestJson<{
      session: BrowserSessionDescriptor;
      sourceConnection: BrowserSessionConnection;
    }>(new URL(
      `/v1/sessions/${encodeURIComponent(created.session.sessionId)}/source-connections`,
      gatewayOrigin,
    ).toString(), {});
    await connectGateway(refreshed.sourceConnection);
  }

  async function requestJson<T>(url: string, value: unknown): Promise<T> {
    const body = JSON.stringify(value);
    const authHeaders = await options.authorize?.({ body, method: "POST", url }) ?? {};
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...authHeaders,
      },
      body,
    });
    if (!response.ok) throw new Error(`Browser gateway source request failed with HTTP ${response.status}.`);
    return response.json() as Promise<T>;
  }

  await connectGateway(created.sourceConnection);

  return {
    session: created.session,
    getMetrics: () => ({ ...metrics }),
    async close() {
      if (closed) return;
      closed = true;
      if (gatewayTimer) clearTimeout(gatewayTimer);
      if (localTimer) clearTimeout(localTimer);
      if (flushTimer) clearTimeout(flushTimer);
      closeLocal();
      const socket = gatewaySocket;
      gatewaySocket = null;
      if (socket && socket.readyState < WebSocket.CLOSING) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 500);
          socket.once("close", () => {
            clearTimeout(timeout);
            resolve();
          });
          socket.close(1000, "Source stopped");
        });
      }
    },
  };
}

export function validateLoopbackStreamUrl(value: string): string {
  const url = new URL(value);
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]";
  if (url.protocol !== "ws:" || !loopback || url.username || url.password) {
    throw new Error("agent-browser source URL must be an unauthenticated loopback ws:// URL.");
  }
  return url.toString();
}

function reconnectDelay(attempt: number, initial: number, maximum: number): number {
  const capped = Math.min(maximum, initial * 2 ** Math.min(attempt, 10));
  return Math.floor(capped * (0.8 + Math.random() * 0.4));
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function decodeJpeg(encoded: string): Uint8Array | null {
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9
  ) return null;
  return bytes;
}
