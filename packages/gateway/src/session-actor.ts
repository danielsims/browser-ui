import { randomUUID } from "node:crypto";
import {
  decodeBrowserSessionBinaryFrame,
  encodeBrowserSessionBinaryFrame,
  BROWSER_SESSION_VERSION,
  parseBrowserSourceMessage,
  parseBrowserViewerMessage,
  type BrowserSessionDescriptor,
  type BrowserSessionCapability,
  type BrowserSessionFrameMessage,
  type BrowserSessionFrameEncoding,
  type BrowserSessionResolvedAccess,
  type BrowserSessionSnapshotMessage,
  type BrowserSessionStatusMessage,
  type BrowserSourceFrameMessage,
} from "@browser-ui/session";
import WebSocket, { type RawData } from "ws";
import type { BrowserGatewayPrincipal } from "./auth.js";

interface ViewerState {
  capabilities: readonly BrowserSessionCapability[];
  clientInstanceId: string;
  frameEncoding: BrowserSessionFrameEncoding;
  pendingFrame: EncodedFrame | null;
  retryTimer: ReturnType<typeof setTimeout> | null;
  sendingFrame: boolean;
  sensitive: boolean;
  socket: WebSocket;
  principalId: string;
}

interface ActiveControlLease {
  expiresAt: number;
  holder: ViewerState;
  id: string;
  timer: ReturnType<typeof setTimeout> | null;
}

interface EncodedFrame {
  binary: Uint8Array;
  capturedAt: number;
  jpeg: Uint8Array;
  json: string | null;
  jsonMessage: BrowserSessionFrameMessage;
}

export type BrowserSessionActorMetric =
  | { type: "source-frame"; bytes: number }
  | { type: "viewer-frame"; bytes: number; latencyMs: number }
  | { type: "viewer-frame-dropped" };

export interface BrowserSessionActorOptions {
  descriptor: BrowserSessionDescriptor;
  producer: BrowserGatewayPrincipal;
  maximumBufferedBytes: number;
  maximumEncodedFrameLength: number;
  onMetric?: (metric: BrowserSessionActorMetric) => void;
  controlLeaseLifetimeMs?: number;
}

export type BrowserControlOperationResult =
  | { ok: true; access: BrowserSessionResolvedAccess }
  | { ok: false; error: "viewer_not_connected" | "control_busy" | "stale_lease" | "session_unavailable" };

export class BrowserSessionActor {
  readonly producer: BrowserGatewayPrincipal;
  readonly #viewers = new Map<WebSocket, ViewerState>();
  readonly #maximumBufferedBytes: number;
  readonly #maximumEncodedFrameLength: number;
  #descriptor: BrowserSessionDescriptor;
  #source: WebSocket | null = null;
  #sourceEpoch: string | null = null;
  #eventSequence = 0;
  #frameSequence = 0;
  #viewportRevision = 0;
  #latestFrame: EncodedFrame | null = null;
  #controlLease: ActiveControlLease | null = null;
  readonly #controlLeaseLifetimeMs: number;
  readonly #onMetric?: BrowserSessionActorOptions["onMetric"];

  constructor(options: BrowserSessionActorOptions) {
    this.#descriptor = options.descriptor;
    this.producer = options.producer;
    this.#maximumBufferedBytes = options.maximumBufferedBytes;
    this.#maximumEncodedFrameLength = options.maximumEncodedFrameLength;
    this.#onMetric = options.onMetric;
    this.#controlLeaseLifetimeMs = options.controlLeaseLifetimeMs ?? 30_000;
  }

  get descriptor(): BrowserSessionDescriptor {
    return this.#descriptor;
  }

  attachSource(socket: WebSocket, principalId: string): boolean {
    if (principalId !== this.producer.id || this.#source?.readyState === WebSocket.OPEN) {
      socket.close(1008, "Source is not authorized");
      return false;
    }
    this.#source = socket;
    this.#sourceEpoch = randomUUID();
    this.#frameSequence = 0;
    this.#latestFrame = null;
    this.#updateStatus("waiting");

    socket.on("message", (data, isBinary) => {
      if (socket !== this.#source) return;
      if (isBinary) this.#handleBinarySourceFrame(data);
      else this.#handleSourceMessage(data);
    });
    socket.on("close", () => {
      if (socket !== this.#source) return;
      this.#source = null;
      this.#releaseControlInternal();
      if (this.#descriptor.status !== "ended") this.#updateStatus("offline");
    });
    socket.on("error", () => socket.close());
    return true;
  }

  attachViewer(
    socket: WebSocket,
    identity: {
      capabilities: readonly BrowserSessionCapability[];
      clientInstanceId: string;
      principalId: string;
      sensitive: boolean;
    },
    frameEncoding: BrowserSessionFrameEncoding,
  ) {
    for (const existing of this.#viewers.values()) {
      if (
        existing.principalId === identity.principalId &&
        existing.clientInstanceId === identity.clientInstanceId
      ) existing.socket.close(1000, "Viewer reconnected");
    }
    const viewer: ViewerState = {
      ...identity,
      frameEncoding,
      pendingFrame: null,
      retryTimer: null,
      sendingFrame: false,
      socket,
    };
    this.#viewers.set(socket, viewer);
    this.#send(socket, {
      v: BROWSER_SESSION_VERSION,
      type: "server.hello",
      sourceEpoch: this.#sourceEpoch,
      eventSequence: this.#eventSequence,
    });
    this.#sendCurrentState(viewer);

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        socket.close(1003, "Text protocol required");
        return;
      }
      const message = parseBrowserViewerMessage(rawText(data));
      if (!message) {
        socket.close(1008, "View-only connection");
        return;
      }
      if (message.type === "client.hello") this.#sendCurrentState(viewer);
      else if (message.type === "heartbeat") {
        this.#renewControl(viewer);
        this.#send(socket, message);
      } else {
        this.#expireControlIfNeeded();
        if (this.#controlLease?.holder !== viewer) {
          this.#sendCurrentState(viewer);
          return;
        }
        this.#send(this.#source, {
          v: BROWSER_SESSION_VERSION,
          type: "source.input",
          leaseId: this.#controlLease.id,
          expiresAt: new Date(this.#controlLease.expiresAt).toISOString(),
          input: message,
        });
      }
    });
    socket.on("close", () => this.#removeViewer(viewer));
    socket.on("error", () => socket.close());
  }

  close() {
    this.#releaseControlInternal();
    this.#source?.close(1001, "Gateway shutting down");
    for (const viewer of this.#viewers.values()) {
      if (viewer.retryTimer) clearTimeout(viewer.retryTimer);
      viewer.socket.close(1001, "Gateway shutting down");
    }
    this.#viewers.clear();
  }

  acquireControl(principalId: string, clientInstanceId: string): BrowserControlOperationResult {
    this.#expireControlIfNeeded();
    if (this.#source?.readyState !== WebSocket.OPEN) {
      return { ok: false, error: "session_unavailable" };
    }
    const viewer = [...this.#viewers.values()].find((candidate) =>
      candidate.principalId === principalId &&
      candidate.clientInstanceId === clientInstanceId
    );
    if (!viewer || !viewer.capabilities.includes("control")) {
      return { ok: false, error: "viewer_not_connected" };
    }
    if (this.#controlLease && this.#controlLease.holder !== viewer) {
      return { ok: false, error: "control_busy" };
    }
    if (this.#controlLease) {
      this.#renewControl(viewer);
    } else {
      const lease: ActiveControlLease = {
        expiresAt: Date.now() + this.#controlLeaseLifetimeMs,
        holder: viewer,
        id: `lease_${randomUUID().replaceAll("-", "")}`,
        timer: null,
      };
      lease.timer = this.#leaseTimer(lease);
      this.#controlLease = lease;
      this.#broadcastSnapshots();
    }
    return { ok: true, access: this.#resolvedAccess(viewer) };
  }

  releaseControl(
    principalId: string,
    clientInstanceId: string,
    leaseId: string | undefined,
  ): BrowserControlOperationResult {
    this.#expireControlIfNeeded();
    const viewer = [...this.#viewers.values()].find((candidate) =>
      candidate.principalId === principalId &&
      candidate.clientInstanceId === clientInstanceId
    );
    if (!viewer) return { ok: false, error: "viewer_not_connected" };
    if (!this.#controlLease) return { ok: true, access: this.#resolvedAccess(viewer) };
    if (
      this.#controlLease.holder !== viewer ||
      this.#controlLease.id !== leaseId
    ) return { ok: false, error: "stale_lease" };
    this.#releaseControlInternal();
    return { ok: true, access: this.#resolvedAccess(viewer) };
  }

  resolvedAccess(
    principalId: string,
    clientInstanceId: string,
    capabilities: readonly BrowserSessionCapability[],
    sensitive = false,
  ): BrowserSessionResolvedAccess {
    const viewer = [...this.#viewers.values()].find((candidate) =>
      candidate.principalId === principalId &&
      candidate.clientInstanceId === clientInstanceId
    );
    return viewer
      ? this.#resolvedAccess(viewer)
      : { principalId, capabilities, sensitive };
  }

  #handleSourceMessage(data: RawData) {
    const message = parseBrowserSourceMessage(rawText(data), {
      maximumEncodedFrameLength: this.#maximumEncodedFrameLength,
    });
    if (!message) {
      this.#source?.close(1008, "Invalid source message");
      return;
    }

    switch (message.type) {
      case "source.frame":
        this.#publishFrame(message);
        break;
      case "source.state": {
        const viewportChanged = message.viewport.width !== this.#descriptor.viewport.width ||
          message.viewport.height !== this.#descriptor.viewport.height;
        if (viewportChanged) this.#viewportRevision += 1;
        this.#descriptor = { ...this.#descriptor, viewport: message.viewport };
        this.#updateStatus(message.status);
        break;
      }
      case "source.page":
        this.#eventSequence += 1;
        this.#broadcastReliable({
          v: BROWSER_SESSION_VERSION,
          type: "url",
          eventSequence: this.#eventSequence,
          url: message.url,
          timestamp: Date.now(),
        });
        break;
      case "heartbeat":
        this.#send(this.#source, message);
        break;
    }
  }

  #handleBinarySourceFrame(data: RawData) {
    const decoded = decodeBrowserSessionBinaryFrame(
      rawBytes(data),
      Math.floor(this.#maximumEncodedFrameLength * 0.75),
    );
    if (!decoded) {
      this.#source?.close(1008, "Invalid binary source frame");
      return;
    }
    this.#publishFrame({
      v: BROWSER_SESSION_VERSION,
      type: "source.frame",
      codec: "image/jpeg",
      data: "",
      width: decoded.header.width,
      height: decoded.header.height,
      capturedAt: decoded.header.capturedAt,
      metadata: decoded.header.metadata,
    }, decoded.jpeg);
  }

  #publishFrame(source: BrowserSourceFrameMessage, binaryJpeg?: Uint8Array) {
    if (!this.#sourceEpoch) return;
    const jpeg = binaryJpeg ?? decodeBase64Jpeg(source.data);
    if (!jpeg) {
      this.#source?.close(1008, "Invalid JPEG frame");
      return;
    }
    const viewportChanged = source.width !== this.#descriptor.viewport.width ||
      source.height !== this.#descriptor.viewport.height;
    if (viewportChanged) {
      this.#viewportRevision += 1;
      this.#descriptor = {
        ...this.#descriptor,
        viewport: { width: source.width, height: source.height },
      };
    }
    if (this.#descriptor.status !== "live" || viewportChanged) this.#updateStatus("live");
    this.#frameSequence += 1;
    const receivedAt = Date.now();
    const capturedAt = source.capturedAt !== undefined &&
        source.capturedAt >= receivedAt - 60_000 &&
        source.capturedAt <= receivedAt + 5_000
      ? source.capturedAt
      : receivedAt;
    const metadata = {
      deviceWidth: source.width,
      deviceHeight: source.height,
      pageScaleFactor: finiteOr(source.metadata?.pageScaleFactor, 1),
      offsetTop: finiteOr(source.metadata?.offsetTop, 0),
      scrollOffsetX: finiteOr(source.metadata?.scrollOffsetX, 0),
      scrollOffsetY: finiteOr(source.metadata?.scrollOffsetY, 0),
      timestamp: finiteOr(source.metadata?.timestamp, capturedAt),
    };
    const frame: BrowserSessionFrameMessage = {
      v: BROWSER_SESSION_VERSION,
      type: "frame",
      codec: "image/jpeg",
      data: source.data,
      width: source.width,
      height: source.height,
      capturedAt,
      sourceEpoch: this.#sourceEpoch,
      frameSequence: this.#frameSequence,
      viewportRevision: this.#viewportRevision,
      metadata,
    };
    const binary = encodeBrowserSessionBinaryFrame({
      v: frame.v,
      type: frame.type,
      codec: frame.codec,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      sourceEpoch: frame.sourceEpoch,
      frameSequence: frame.frameSequence,
      viewportRevision: frame.viewportRevision,
      metadata: frame.metadata,
    }, jpeg);
    this.#latestFrame = {
      binary,
      capturedAt: frame.capturedAt,
      jpeg,
      json: source.data ? JSON.stringify(frame) : null,
      jsonMessage: frame,
    };
    this.#onMetric?.({ type: "source-frame", bytes: jpeg.byteLength });
    for (const viewer of this.#viewers.values()) this.#queueLatestFrame(viewer, this.#latestFrame);
  }

  #updateStatus(status: BrowserSessionDescriptor["status"]) {
    this.#descriptor = { ...this.#descriptor, status };
    this.#eventSequence += 1;
    const statusMessage: BrowserSessionStatusMessage = {
      v: BROWSER_SESSION_VERSION,
      type: "status",
      status,
      sourceEpoch: this.#sourceEpoch,
      eventSequence: this.#eventSequence,
      viewport: this.#descriptor.viewport,
      connected: status === "live" || status === "waiting",
      screencasting: status === "live",
      viewportWidth: this.#descriptor.viewport.width,
      viewportHeight: this.#descriptor.viewport.height,
    };
    this.#broadcastReliable(statusMessage);
    this.#broadcastSnapshots();
  }

  #snapshot(viewer: ViewerState): BrowserSessionSnapshotMessage {
    return {
      v: BROWSER_SESSION_VERSION,
      type: "session.snapshot",
      eventSequence: this.#eventSequence,
      sourceEpoch: this.#sourceEpoch,
      session: this.#descriptor,
      access: this.#resolvedAccess(viewer),
    };
  }

  #sendCurrentState(viewer: ViewerState) {
    this.#send(viewer.socket, this.#snapshot(viewer));
    this.#send(viewer.socket, {
      v: BROWSER_SESSION_VERSION,
      type: "status",
      status: this.#descriptor.status,
      sourceEpoch: this.#sourceEpoch,
      eventSequence: this.#eventSequence,
      viewport: this.#descriptor.viewport,
      connected: this.#descriptor.status === "live" || this.#descriptor.status === "waiting",
      screencasting: this.#descriptor.status === "live",
      viewportWidth: this.#descriptor.viewport.width,
      viewportHeight: this.#descriptor.viewport.height,
    } satisfies BrowserSessionStatusMessage);
    if (this.#latestFrame) this.#queueLatestFrame(viewer, this.#latestFrame);
  }

  #broadcastSnapshots() {
    for (const viewer of this.#viewers.values()) {
      this.#send(viewer.socket, this.#snapshot(viewer));
    }
  }

  #broadcastReliable(message: unknown) {
    for (const viewer of this.#viewers.values()) this.#send(viewer.socket, message);
  }

  #send(socket: WebSocket | null, message: unknown): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > this.#maximumBufferedBytes * 2) {
      socket.close(1008, "Viewer is too slow");
      return false;
    }
    try {
      socket.send(JSON.stringify(message));
      return true;
    } catch {
      socket.close();
      return false;
    }
  }

  #queueLatestFrame(viewer: ViewerState, frame: EncodedFrame) {
    if (viewer.pendingFrame) this.#onMetric?.({ type: "viewer-frame-dropped" });
    viewer.pendingFrame = frame;
    this.#flushFrame(viewer);
  }

  #flushFrame(viewer: ViewerState) {
    if (
      viewer.sendingFrame ||
      !viewer.pendingFrame ||
      viewer.socket.readyState !== WebSocket.OPEN
    ) return;
    if (viewer.socket.bufferedAmount > this.#maximumBufferedBytes) {
      if (!viewer.retryTimer) {
        viewer.retryTimer = setTimeout(() => {
          viewer.retryTimer = null;
          this.#flushFrame(viewer);
        }, 25);
      }
      return;
    }
    const frame = viewer.pendingFrame;
    viewer.pendingFrame = null;
    viewer.sendingFrame = true;
    const payload = viewer.frameEncoding === "binary-jpeg"
      ? frame.binary
      : (frame.json ??= JSON.stringify({
          ...frame.jsonMessage,
          data: Buffer.from(frame.jpeg).toString("base64"),
        }));
    viewer.socket.send(payload, (error) => {
      viewer.sendingFrame = false;
      if (error) viewer.socket.close();
      else {
        this.#onMetric?.({
          type: "viewer-frame",
          bytes: typeof payload === "string" ? Buffer.byteLength(payload) : payload.byteLength,
          latencyMs: Math.max(0, Date.now() - frame.capturedAt),
        });
        this.#flushFrame(viewer);
      }
    });
  }

  #removeViewer(viewer: ViewerState) {
    if (viewer.retryTimer) clearTimeout(viewer.retryTimer);
    if (this.#controlLease?.holder === viewer) this.#releaseControlInternal();
    this.#viewers.delete(viewer.socket);
  }

  #resolvedAccess(viewer: ViewerState): BrowserSessionResolvedAccess {
    this.#expireControlIfNeeded();
    const lease = this.#controlLease;
    return {
      principalId: viewer.principalId,
      capabilities: viewer.capabilities,
      sensitive: viewer.sensitive,
      ...(lease
        ? {
            controllerId: lease.holder.principalId,
            lease: {
              ...(lease.holder === viewer ? { id: lease.id } : {}),
              holderId: lease.holder.principalId,
              expiresAt: new Date(lease.expiresAt).toISOString(),
              renewable: true,
            },
          }
        : {}),
    };
  }

  #renewControl(viewer: ViewerState) {
    this.#expireControlIfNeeded();
    const lease = this.#controlLease;
    if (!lease || lease.holder !== viewer) return;
    if (lease.timer) clearTimeout(lease.timer);
    lease.expiresAt = Date.now() + this.#controlLeaseLifetimeMs;
    lease.timer = this.#leaseTimer(lease);
    this.#broadcastSnapshots();
  }

  #leaseTimer(lease: ActiveControlLease): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      if (this.#controlLease?.id === lease.id) this.#releaseControlInternal();
    }, Math.max(1, lease.expiresAt - Date.now()));
  }

  #expireControlIfNeeded() {
    if (this.#controlLease && this.#controlLease.expiresAt <= Date.now()) {
      this.#releaseControlInternal();
    }
  }

  #releaseControlInternal() {
    const lease = this.#controlLease;
    if (!lease) return;
    if (lease.timer) clearTimeout(lease.timer);
    this.#controlLease = null;
    this.#broadcastSnapshots();
  }
}

function rawText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(new Uint8Array(data)).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function rawBytes(data: RawData): Uint8Array {
  return Array.isArray(data) ? Buffer.concat(data) : new Uint8Array(data);
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function decodeBase64Jpeg(encoded: string): Uint8Array | null {
  if (!encoded) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(encoded, "base64");
  } catch {
    return null;
  }
  if (
    bytes.byteLength < 4 ||
    bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
    bytes[bytes.byteLength - 2] !== 0xff || bytes[bytes.byteLength - 1] !== 0xd9
  ) return null;
  return bytes;
}
