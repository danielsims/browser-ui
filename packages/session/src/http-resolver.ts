import {
  BROWSER_SESSION_PROTOCOL,
  type BrowserSessionConnectionRequest,
  type BrowserSessionHttpAuthorization,
  type BrowserSessionResolver,
  type ResolvedBrowserSession,
} from "./types.js";

export interface HttpBrowserSessionResolverOptions {
  gatewayOrigin: string;
  authorize?: BrowserSessionHttpAuthorization;
  fetch?: typeof globalThis.fetch;
}

export function createHttpBrowserSessionResolver({
  gatewayOrigin,
  authorize,
  fetch: fetchImplementation = globalThis.fetch,
}: HttpBrowserSessionResolverOptions): BrowserSessionResolver {
  const origin = normalizeGatewayOrigin(gatewayOrigin);
  if (!fetchImplementation) throw new Error("A fetch implementation is required.");

  return async (request: BrowserSessionConnectionRequest) => {
    const url = new URL(
      `/v1/sessions/${encodeURIComponent(request.sessionId)}/connections`,
      origin,
    ).toString();
    const body = JSON.stringify({
      intent: request.intent,
      clientInstanceId: request.clientInstanceId,
      ...(request.frameEncodings ? { frameEncodings: request.frameEncodings } : {}),
      ...(request.resume ? { resume: request.resume } : {}),
    });
    const authorizationHeaders = await authorize?.({ body, method: "POST", url }) ?? {};
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...authorizationHeaders,
      },
      body,
    });
    if (!response.ok) {
      throw new Error(`Browser session resolution failed with HTTP ${response.status}.`);
    }
    const resolution = await response.json() as unknown;
    if (!isResolution(resolution)) {
      throw new Error("Browser session gateway returned an invalid connection response.");
    }
    if (!resolution.connection.protocols.includes(BROWSER_SESSION_PROTOCOL)) {
      throw new Error(`Browser session gateway did not negotiate ${BROWSER_SESSION_PROTOCOL}.`);
    }
    return resolution;
  };
}

export function normalizeGatewayOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Browser session gateway origin must use HTTP or HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Browser session gateway must be an origin without credentials, path, query, or fragment.");
  }
  return url.origin;
}

function isResolution(value: unknown): value is ResolvedBrowserSession {
  if (!isRecord(value) || !isRecord(value.session) || !isRecord(value.connection) || !isRecord(value.access)) {
    return false;
  }
  const protocols = value.connection.protocols;
  return value.session.version === 1 &&
    typeof value.session.sessionId === "string" &&
    typeof value.session.title === "string" &&
    typeof value.connection.url === "string" &&
    Array.isArray(protocols) && protocols.every((protocol) => typeof protocol === "string") &&
    typeof value.connection.expiresAt === "string" &&
    (value.connection.frameEncoding === "binary-jpeg" || value.connection.frameEncoding === "json-base64") &&
    Array.isArray(value.access.capabilities) &&
    value.access.capabilities.every((capability) => typeof capability === "string") &&
    typeof value.access.sensitive === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
