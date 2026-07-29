import type {
  BrowserSessionCapability,
  BrowserViewportSize,
} from "@browser-ui/core";
export type { BrowserSessionCapability } from "@browser-ui/core";

export const BROWSER_SESSION_PROTOCOL = "browser-session.v1";
export const BROWSER_SESSION_BINARY_PROTOCOL = "browser-session.v1.binary-jpeg";
export const BROWSER_SESSION_VERSION = 1 as const;

export type BrowserSessionFrameEncoding = "binary-jpeg" | "json-base64";

export type BrowserSessionStatus = "waiting" | "live" | "offline" | "ended";

export interface BrowserSessionDescriptor {
  version: typeof BROWSER_SESSION_VERSION;
  sessionId: string;
  title: string;
  status: BrowserSessionStatus;
  viewport: BrowserViewportSize;
  createdAt: string;
  expiresAt?: string;
}

export interface BrowserSessionResumeCursor {
  sourceEpoch?: string;
  lastEventSequence?: number;
  lastFrameSequence?: number;
}

export interface BrowserSessionConnectionRequest {
  sessionId: string;
  intent: "observe";
  clientInstanceId: string;
  /** Ordered by preference. Binary JPEG avoids base64 overhead and is recommended. */
  frameEncodings?: readonly BrowserSessionFrameEncoding[];
  resume?: BrowserSessionResumeCursor;
}

export interface BrowserSessionConnection {
  url: string;
  protocols: readonly string[];
  expiresAt: string;
  frameEncoding: BrowserSessionFrameEncoding;
}

export interface BrowserSessionResolvedAccess {
  principalId: string;
  capabilities: readonly BrowserSessionCapability[];
  sensitive: boolean;
  controllerId?: string;
  lease?: {
    id?: string;
    holderId: string;
    expiresAt: string;
    renewable: boolean;
  };
}

export interface BrowserSessionControlRequest {
  action: "acquire" | "release";
  clientInstanceId: string;
  leaseId?: string;
}

export interface BrowserSessionControlResult {
  access: BrowserSessionResolvedAccess;
}

export interface ResolvedBrowserSession {
  session: BrowserSessionDescriptor;
  access: BrowserSessionResolvedAccess;
  connection: BrowserSessionConnection;
}

export type BrowserSessionResolver = (
  request: BrowserSessionConnectionRequest,
) => Promise<ResolvedBrowserSession>;

export interface BrowserSessionHttpAuthorizationRequest {
  body: string;
  method: "POST";
  url: string;
}

export type BrowserSessionHttpAuthorization = (
  request: BrowserSessionHttpAuthorizationRequest,
) => Promise<Record<string, string>> | Record<string, string>;
