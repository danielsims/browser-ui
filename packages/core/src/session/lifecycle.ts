export const BROWSER_SESSION_LIFECYCLE_VERSION = 1 as const;

export const browserSessionEndReasons = [
  "completed",
  "user-ended",
  "replaced",
  "unavailable",
] as const;

export type BrowserSessionEndReason = (typeof browserSessionEndReasons)[number];

export const browserSessionReleaseOutcomes = ["completed", "waiting"] as const;

export type BrowserSessionReleaseOutcome =
  (typeof browserSessionReleaseOutcomes)[number];

/** Portable handoff that relinquishes agent control without terminating the session. */
export interface BrowserSessionReleaseRequest {
  version: typeof BROWSER_SESSION_LIFECYCLE_VERSION;
  releaseId: string;
  sessionId: string;
  outcome: BrowserSessionReleaseOutcome;
  label?: string;
  url?: string;
  title?: string;
}

/** Durable acknowledgement that a browser remains available after agent control ends. */
export interface BrowserSessionReleaseReceipt extends BrowserSessionReleaseRequest {
  status: "released";
  releasedAt: string;
}

/** Portable intent sent when a host wants to terminate, not merely hide, a session. */
export interface BrowserSessionEndRequest {
  version: typeof BROWSER_SESSION_LIFECYCLE_VERSION;
  sessionId: string;
  clientInstanceId: string;
  reason: BrowserSessionEndReason;
}

/** Authoritative acknowledgement returned after the session entered its terminal state. */
export interface BrowserSessionEndReceipt {
  version: typeof BROWSER_SESSION_LIFECYCLE_VERSION;
  sessionId: string;
  status: "ended";
  reason: BrowserSessionEndReason;
  endedAt: string;
}

export type BrowserSessionTerminator = (
  request: BrowserSessionEndRequest,
) => Promise<BrowserSessionEndReceipt>;

export interface BrowserSessionHttpTerminatorOptions {
  gatewayOrigin: string;
  authorize: (request: {
    body: string;
    method: "POST";
    url: string;
  }) => Promise<Record<string, string>> | Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export function createBrowserSessionEndRequest(
  sessionId: string,
  clientInstanceId: string,
  reason: BrowserSessionEndReason = "user-ended",
): BrowserSessionEndRequest {
  const request = {
    version: BROWSER_SESSION_LIFECYCLE_VERSION,
    sessionId,
    clientInstanceId,
    reason,
  } as const;
  if (!isBrowserSessionEndRequest(request)) {
    throw new TypeError("Invalid browser session end request.");
  }
  return request;
}

export function createBrowserSessionReleaseRequest(
  releaseId: string,
  sessionId: string,
  outcome: BrowserSessionReleaseOutcome,
  metadata: Pick<BrowserSessionReleaseRequest, "label" | "url" | "title"> = {},
): BrowserSessionReleaseRequest {
  const request = {
    version: BROWSER_SESSION_LIFECYCLE_VERSION,
    releaseId,
    sessionId,
    outcome,
    ...metadata,
  };
  if (!isBrowserSessionReleaseRequest(request)) {
    throw new TypeError("Invalid browser session release request.");
  }
  return request;
}

export function isBrowserSessionReleaseRequest(
  value: unknown,
): value is BrowserSessionReleaseRequest {
  if (!record(value)) return false;
  return value.version === BROWSER_SESSION_LIFECYCLE_VERSION &&
    boundedIdentifier(value.releaseId) &&
    boundedIdentifier(value.sessionId) &&
    browserSessionReleaseOutcomes.includes(
      value.outcome as BrowserSessionReleaseOutcome,
    ) &&
    optionalBoundedString(value.label, 160) &&
    optionalBoundedString(value.title, 256) &&
    optionalSafeHttpURL(value.url);
}

export function isBrowserSessionReleaseReceipt(
  value: unknown,
): value is BrowserSessionReleaseReceipt {
  if (!record(value)) return false;
  return value.status === "released" &&
    typeof value.releasedAt === "string" &&
    Number.isFinite(Date.parse(value.releasedAt)) &&
    isBrowserSessionReleaseRequest(value);
}

export function isBrowserSessionEndRequest(value: unknown): value is BrowserSessionEndRequest {
  if (!record(value)) return false;
  return value.version === BROWSER_SESSION_LIFECYCLE_VERSION &&
    boundedIdentifier(value.sessionId) &&
    boundedIdentifier(value.clientInstanceId) &&
    browserSessionEndReasons.includes(value.reason as BrowserSessionEndReason);
}

export function isBrowserSessionEndReceipt(value: unknown): value is BrowserSessionEndReceipt {
  if (!record(value)) return false;
  return value.version === BROWSER_SESSION_LIFECYCLE_VERSION &&
    boundedIdentifier(value.sessionId) &&
    value.status === "ended" &&
    browserSessionEndReasons.includes(value.reason as BrowserSessionEndReason) &&
    typeof value.endedAt === "string" &&
    Number.isFinite(Date.parse(value.endedAt));
}

/** Create a fresh authenticated HTTP request for every termination attempt. */
export function createHttpBrowserSessionTerminator(
  options: BrowserSessionHttpTerminatorOptions,
): BrowserSessionTerminator {
  const origin = normalizeLifecycleGatewayOrigin(options.gatewayOrigin);
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (!fetchImplementation) throw new Error("A fetch implementation is required.");

  return async (request) => {
    if (!isBrowserSessionEndRequest(request)) {
      throw new TypeError("Invalid browser session end request.");
    }
    const url = new URL(
      `/v1/sessions/${encodeURIComponent(request.sessionId)}/end`,
      origin,
    ).toString();
    const body = JSON.stringify(request);
    const authorization = await options.authorize({ body, method: "POST", url });
    const response = await fetchImplementation(url, {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...authorization,
      },
    });
    if (!response.ok) {
      throw new Error(`Browser session termination failed with HTTP ${response.status}.`);
    }
    const receipt: unknown = await response.json();
    if (!isBrowserSessionEndReceipt(receipt)) {
      throw new Error("Browser session termination returned an invalid receipt.");
    }
    return receipt;
  };
}

function normalizeLifecycleGatewayOrigin(value: string): string {
  const url = new URL(value);
  if ((url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) {
    throw new TypeError("gatewayOrigin must be a clean HTTP(S) origin.");
  }
  return url.origin;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

function optionalBoundedString(value: unknown, maximumLength: number): boolean {
  return value === undefined ||
    (typeof value === "string" && value.length <= maximumLength);
}

function optionalSafeHttpURL(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
