import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import {
  BROWSER_SESSION_BINARY_PROTOCOL,
  BROWSER_SESSION_PROTOCOL,
  BROWSER_SESSION_VERSION,
  type BrowserSessionDescriptor,
  type BrowserSessionCapability,
  type BrowserSessionResolvedAccess,
  type BrowserSessionFrameEncoding,
} from "@browser-ui/core";
import { WebSocketServer } from "ws";
import type {
  BrowserGatewayAuthenticator,
  BrowserGatewayAuthorizer,
  BrowserGatewayPrincipal,
} from "./auth.js";
import { BrowserSessionActor } from "./session-actor.js";
import { OneTimeBrowserGatewayTickets } from "./tickets.js";

export interface BrowserSessionGatewayOptions {
  authenticate: BrowserGatewayAuthenticator;
  authorize: BrowserGatewayAuthorizer;
  /** Canonical public HTTP(S) origin, or a request-aware resolver for tests/proxies. */
  publicOrigin: string | ((request: IncomingMessage) => string);
  /** Browser origins allowed to resolve session connections over HTTP. */
  allowedRequestOrigins?: readonly string[];
  ticketLifetimeMs?: number;
  maximumRequestBytes?: number;
  maximumWebSocketPayloadBytes?: number;
  maximumEncodedFrameLength?: number;
  /** Backpressure threshold used to disconnect a viewer before reliable messages grow without bound. */
  maximumBufferedBytes?: number;
  /** Bytes of queued frame data tolerated before retaining only the latest frame. Defaults to zero. */
  maximumFrameBufferedBytes?: number;
  controlLeaseLifetimeMs?: number;
}

export interface BrowserSessionGateway {
  server: Server;
  getMetrics(): BrowserSessionGatewayMetrics;
  close(): Promise<void>;
}

export interface BrowserSessionGatewayMetrics {
  sourceFramesReceived: number;
  sourceBytesReceived: number;
  viewerFramesSent: number;
  viewerFramesDropped: number;
  viewerBytesSent: number;
  lastFrameFanoutLatencyMs: number;
  maximumFrameFanoutLatencyMs: number;
}

interface CreateSessionBody {
  title: string;
  viewport: { width: number; height: number };
  expiresAt?: string;
}

export function createBrowserSessionGateway(options: BrowserSessionGatewayOptions): BrowserSessionGateway {
  const maximumRequestBytes = options.maximumRequestBytes ?? 32 * 1024;
  const maximumWebSocketPayloadBytes = options.maximumWebSocketPayloadBytes ?? 32 * 1024 * 1024;
  const maximumEncodedFrameLength = options.maximumEncodedFrameLength ?? 24 * 1024 * 1024;
  const maximumBufferedBytes = options.maximumBufferedBytes ?? 2 * 1024 * 1024;
  const maximumFrameBufferedBytes = options.maximumFrameBufferedBytes ?? 0;
  const allowedRequestOrigins = new Set(
    options.allowedRequestOrigins?.map(canonicalHttpOrigin) ?? [],
  );
  const actors = new Map<string, BrowserSessionActor>();
  const tickets = new OneTimeBrowserGatewayTickets(options.ticketLifetimeMs);
  const sourceSockets = websocketServer(maximumWebSocketPayloadBytes);
  const viewerSockets = websocketServer(maximumWebSocketPayloadBytes);
  const metrics: BrowserSessionGatewayMetrics = {
    sourceFramesReceived: 0,
    sourceBytesReceived: 0,
    viewerFramesSent: 0,
    viewerFramesDropped: 0,
    viewerBytesSent: 0,
    lastFrameFanoutLatencyMs: 0,
    maximumFrameFanoutLatencyMs: 0,
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response).catch(() => {
      if (!response.headersSent) json(response, 500, { error: "internal_error" });
      else response.destroy();
    });
  });

  server.on("upgrade", (request, socket, head) => {
    void handleUpgrade(request, socket, head).catch(() => rejectUpgrade(socket, 500));
  });

  async function handleRequest(request: IncomingMessage, response: ServerResponse) {
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    const requestOrigin = allowedRequestOrigin(request, allowedRequestOrigins);
    if (requestOrigin) applyCorsHeaders(request, response, requestOrigin);
    if (request.method === "OPTIONS" && request.headers.origin) {
      if (!requestOrigin) return json(response, 403, { error: "origin_forbidden" });
      response.writeHead(204, { "content-length": "0" });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/v1/sessions") {
      const principal = await options.authenticate(request, "source:create");
      if (!principal) return json(response, 401, { error: "unauthorized" });
      const body = await readJson<CreateSessionBody>(request, maximumRequestBytes);
      if (!validCreateSession(body)) return json(response, 400, { error: "invalid_session" });
      const sessionId = `bs_${randomBytes(18).toString("base64url")}`;
      const descriptor: BrowserSessionDescriptor = {
        version: BROWSER_SESSION_VERSION,
        sessionId,
        title: body.title,
        status: "waiting",
        viewport: body.viewport,
        createdAt: new Date().toISOString(),
        ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
      };
      const actor = new BrowserSessionActor({
        descriptor,
        producer: principal,
        maximumBufferedBytes,
        maximumFrameBufferedBytes,
        maximumEncodedFrameLength,
        controlLeaseLifetimeMs: options.controlLeaseLifetimeMs,
        onMetric(metric) {
          if (metric.type === "source-frame") {
            metrics.sourceFramesReceived += 1;
            metrics.sourceBytesReceived += metric.bytes;
          } else if (metric.type === "viewer-frame-dropped") {
            metrics.viewerFramesDropped += 1;
          } else {
            metrics.viewerFramesSent += 1;
            metrics.viewerBytesSent += metric.bytes;
            metrics.lastFrameFanoutLatencyMs = metric.latencyMs;
            metrics.maximumFrameFanoutLatencyMs = Math.max(
              metrics.maximumFrameFanoutLatencyMs,
              metric.latencyMs,
            );
          }
        },
      });
      actors.set(sessionId, actor);
      const sourceConnection = issueConnection(request, tickets.issue({
        role: "source",
        sessionId,
        principalId: principal.id,
      }), "source", "binary-jpeg");
      json(response, 201, { session: descriptor, sourceConnection });
      return;
    }

    const sourceMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/source-connections$/);
    if (request.method === "POST" && sourceMatch) {
      const sessionId = decodeURIComponent(sourceMatch[1] ?? "");
      const actor = actors.get(sessionId);
      if (!actor) return json(response, 404, { error: "not_found" });
      const principal = await options.authenticate(request, "source:connect");
      if (!principal || principal.id !== actor.producer.id) {
        return json(response, 403, { error: "forbidden" });
      }
      const sourceConnection = issueConnection(request, tickets.issue({
        role: "source",
        sessionId,
        principalId: principal.id,
      }), "source", "binary-jpeg");
      json(response, 200, { session: actor.descriptor, sourceConnection });
      return;
    }

    const viewerMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/connections$/);
    if (request.method === "POST" && viewerMatch) {
      const sessionId = decodeURIComponent(viewerMatch[1] ?? "");
      const actor = actors.get(sessionId);
      if (!actor) return json(response, 404, { error: "not_found" });
      const principal = await options.authenticate(request, "viewer:observe");
      if (!principal) return json(response, 401, { error: "unauthorized" });
      const body = await readJson<Record<string, unknown>>(request, maximumRequestBytes);
      if (body.intent !== "observe" || !validClientInstanceId(body.clientInstanceId)) {
        return json(response, 400, { error: "invalid_connection_request" });
      }
      const allowed = await options.authorize({
        principal,
        session: actor.descriptor,
        producer: actor.producer,
        capability: "observe",
      });
      if (!allowed) return json(response, 403, { error: "forbidden" });
      const capabilities: BrowserSessionCapability[] = ["observe"];
      if (await options.authorize({
        principal,
        session: actor.descriptor,
        producer: actor.producer,
        capability: "control",
      })) capabilities.push("control");
      const issued = tickets.issue({
        role: "viewer",
        sessionId,
        principalId: principal.id,
        clientInstanceId: body.clientInstanceId,
        capabilities,
        frameEncoding: selectFrameEncoding(body.frameEncodings),
      });
      const access: BrowserSessionResolvedAccess = actor.resolvedAccess(
        principal.id,
        body.clientInstanceId,
        capabilities,
      );
      json(response, 200, {
        session: actor.descriptor,
        access,
        connection: issueConnection(
          request,
          issued,
          "view",
          selectFrameEncoding(body.frameEncodings),
        ),
      });
      return;
    }

    const controlMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/control$/);
    if (request.method === "POST" && controlMatch) {
      const sessionId = decodeURIComponent(controlMatch[1] ?? "");
      const actor = actors.get(sessionId);
      if (!actor) return json(response, 404, { error: "not_found" });
      const principal = await options.authenticate(request, "viewer:control");
      if (!principal) return json(response, 401, { error: "unauthorized" });
      const allowed = await options.authorize({
        principal,
        session: actor.descriptor,
        producer: actor.producer,
        capability: "control",
      });
      if (!allowed) return json(response, 403, { error: "forbidden" });
      const body = await readJson<Record<string, unknown>>(request, maximumRequestBytes);
      if (
        (body.action !== "acquire" && body.action !== "release") ||
        !validClientInstanceId(body.clientInstanceId) ||
        (body.leaseId !== undefined && typeof body.leaseId !== "string")
      ) return json(response, 400, { error: "invalid_control_request" });
      const result = body.action === "acquire"
        ? actor.acquireControl(principal.id, body.clientInstanceId)
        : actor.releaseControl(principal.id, body.clientInstanceId, body.leaseId);
      if (!result.ok) return json(response, 409, { error: result.error });
      json(response, 200, { access: result.access });
      return;
    }

    json(response, 404, { error: "not_found" });
  }

  async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(request.url ?? "/", "http://gateway.invalid");
    const role = url.pathname === "/v1/source"
      ? "source"
      : url.pathname === "/v1/view" ? "viewer" : null;
    if (!role) return rejectUpgrade(socket, 404);
    const protocols = parseProtocols(request.headers["sec-websocket-protocol"]);
    if (!protocols.includes(BROWSER_SESSION_PROTOCOL)) return rejectUpgrade(socket, 400);
    const claims = tickets.consume(protocols, role);
    if (!claims) return rejectUpgrade(socket, 401);
    const actor = actors.get(claims.sessionId);
    if (!actor) return rejectUpgrade(socket, 404);
    const selected = role === "source" ? sourceSockets : viewerSockets;
    selected.handleUpgrade(request, socket, head, (webSocket) => {
      if (role === "source") actor.attachSource(webSocket, claims.principalId);
      else if (claims.clientInstanceId) actor.attachViewer(
        webSocket,
        {
          capabilities: claims.capabilities ?? ["observe"],
          clientInstanceId: claims.clientInstanceId,
          principalId: claims.principalId,
          sensitive: false,
        },
        claims.frameEncoding ?? "json-base64",
      );
      else webSocket.close(1008, "Viewer identity is missing");
    });
  }

  return {
    server,
    getMetrics: () => ({ ...metrics }),
    async close() {
      for (const actor of actors.values()) actor.close();
      actors.clear();
      sourceSockets.close();
      viewerSockets.close();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    },
  };

  function issueConnection(
    request: IncomingMessage,
    issued: { protocol: string; expiresAt: string },
    route: "source" | "view",
    frameEncoding: BrowserSessionFrameEncoding,
  ) {
    const publicOrigin = resolvePublicOrigin(options.publicOrigin, request);
    const socketOrigin = new URL(publicOrigin);
    socketOrigin.protocol = socketOrigin.protocol === "https:" ? "wss:" : "ws:";
    return {
      url: new URL(`/v1/${route}`, socketOrigin).toString(),
      protocols: [
        ...(frameEncoding === "binary-jpeg" ? [BROWSER_SESSION_BINARY_PROTOCOL] : []),
        BROWSER_SESSION_PROTOCOL,
        issued.protocol,
      ],
      expiresAt: issued.expiresAt,
      frameEncoding,
    };
  }
}

function websocketServer(maxPayload: number): WebSocketServer {
  return new WebSocketServer({
    noServer: true,
    maxPayload,
    handleProtocols(protocols) {
      if (protocols.has(BROWSER_SESSION_BINARY_PROTOCOL)) return BROWSER_SESSION_BINARY_PROTOCOL;
      return protocols.has(BROWSER_SESSION_PROTOCOL) ? BROWSER_SESSION_PROTOCOL : false;
    },
  });
}

function resolvePublicOrigin(
  configured: BrowserSessionGatewayOptions["publicOrigin"],
  request: IncomingMessage,
): string {
  const value = typeof configured === "function" ? configured(request) : configured;
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.pathname !== "/") {
    throw new Error("publicOrigin must be a canonical HTTP(S) origin.");
  }
  return url.origin;
}

function canonicalHttpOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== value.replace(/\/$/, "")
  ) {
    throw new Error("allowedRequestOrigins must contain canonical HTTP(S) origins.");
  }
  return url.origin;
}

function allowedRequestOrigin(
  request: IncomingMessage,
  allowed: ReadonlySet<string>,
): string | null {
  const origin = request.headers.origin;
  return typeof origin === "string" && allowed.has(origin) ? origin : null;
}

function applyCorsHeaders(
  request: IncomingMessage,
  response: ServerResponse,
  origin: string,
) {
  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "authorization, content-type");
  response.setHeader("access-control-max-age", "600");
  response.setHeader("vary", "Origin");
  if (request.headers["access-control-request-private-network"] === "true") {
    response.setHeader("access-control-allow-private-network", "true");
  }
}

async function readJson<T>(request: IncomingMessage, maximumBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function validCreateSession(value: unknown): value is CreateSessionBody {
  if (!isRecord(value) || typeof value.title !== "string" || value.title.length < 1 || value.title.length > 160) {
    return false;
  }
  if (!isRecord(value.viewport) || !dimension(value.viewport.width) || !dimension(value.viewport.height)) {
    return false;
  }
  return value.expiresAt === undefined ||
    (typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)));
}

function validClientInstanceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function selectFrameEncoding(value: unknown): BrowserSessionFrameEncoding {
  if (Array.isArray(value) && value.includes("binary-jpeg")) return "binary-jpeg";
  return "json-base64";
}

function dimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 8192;
}

function parseProtocols(value: string | string[] | undefined): string[] {
  const joined = Array.isArray(value) ? value.join(",") : value ?? "";
  return joined.split(",").map((protocol) => protocol.trim()).filter(Boolean);
}

function rejectUpgrade(socket: Duplex, status: number) {
  if (socket.destroyed) return;
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

function json(response: ServerResponse, status: number, body: unknown) {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(encoded),
    "cache-control": "no-store",
  });
  response.end(encoded);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
