import type { BrowserViewportSize } from "../geometry.js";
import type { BrowserAgentActivity, BrowserAgentCursorState } from "../presentation.js";
import {
  BROWSER_SESSION_VERSION,
  type BrowserSessionDescriptor,
  type BrowserSessionResolvedAccess,
  type BrowserSessionResumeCursor,
  type BrowserSessionStatus,
} from "./types.js";

export interface BrowserSessionClientHelloMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "client.hello";
  resume?: BrowserSessionResumeCursor;
}

export interface BrowserSessionHeartbeatMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "heartbeat";
  sentAt: number;
}

export interface BrowserSessionServerHelloMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "server.hello";
  sourceEpoch: string | null;
  eventSequence: number;
}

export interface BrowserSessionSnapshotMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "session.snapshot";
  eventSequence: number;
  sourceEpoch: string | null;
  session: BrowserSessionDescriptor;
  access: BrowserSessionResolvedAccess;
}

export interface BrowserSessionFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

/**
 * A normalized JPEG frame. `metadata` keeps v1 compatible with the existing
 * lightweight viewers while source adapters remain hidden behind the gateway.
 */
export interface BrowserSessionFrameMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "frame";
  codec: "image/jpeg";
  data: string;
  width: number;
  height: number;
  capturedAt: number;
  sourceEpoch: string;
  frameSequence: number;
  viewportRevision: number;
  metadata: BrowserSessionFrameMetadata;
}

/** Additive v1 status message understood by both neutral and legacy viewers. */
export interface BrowserSessionStatusMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "status";
  status: BrowserSessionStatus;
  sourceEpoch: string | null;
  eventSequence: number;
  viewport: BrowserViewportSize;
  connected: boolean;
  screencasting: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface BrowserSessionPageMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "url";
  eventSequence: number;
  url: string;
  timestamp: number;
}

export interface BrowserSourceFrameMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "source.frame";
  codec: "image/jpeg";
  data: string;
  width: number;
  height: number;
  capturedAt?: number;
  metadata?: Partial<BrowserSessionFrameMetadata>;
}

export interface BrowserSourceStateMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "source.state";
  status: Exclude<BrowserSessionStatus, "ended">;
  viewport: BrowserViewportSize;
}

export interface BrowserSourcePageMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "source.page";
  url: string;
}

export interface BrowserSourceActivityMessage extends BrowserAgentActivity {
  v: typeof BROWSER_SESSION_VERSION;
  type: "source.activity";
}

export interface BrowserMouseInputMessage {
  type: "input_mouse";
  eventType: "mouseMoved" | "mousePressed" | "mouseReleased" | "mouseWheel";
  x: number;
  y: number;
  button?: "left" | "middle" | "right" | "none";
  clickCount?: number;
  modifiers: number;
  deltaX?: number;
  deltaY?: number;
}

export interface BrowserKeyboardInputMessage {
  type: "input_keyboard";
  eventType: "keyDown" | "keyUp" | "char";
  key: string;
  code: string;
  text?: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
}

export interface BrowserNavigationInputMessage {
  type: "input_navigation";
  direction: "back" | "forward";
}

export type BrowserSessionInputMessage =
  | BrowserMouseInputMessage
  | BrowserKeyboardInputMessage
  | BrowserNavigationInputMessage;

export interface BrowserSourceInputMessage {
  v: typeof BROWSER_SESSION_VERSION;
  type: "source.input";
  leaseId: string;
  expiresAt: string;
  input: BrowserSessionInputMessage;
}

export type BrowserSourceMessage =
  | BrowserSourceFrameMessage
  | BrowserSourceStateMessage
  | BrowserSourcePageMessage
  | BrowserSourceActivityMessage
  | BrowserSessionHeartbeatMessage;

export type BrowserViewerMessage =
  | BrowserSessionClientHelloMessage
  | BrowserSessionHeartbeatMessage
  | BrowserSessionInputMessage;

export interface BrowserSourceMessageLimits {
  maximumEncodedFrameLength?: number;
  maximumViewportDimension?: number;
}

export function parseBrowserSourceMessage(
  value: unknown,
  limits: BrowserSourceMessageLimits = {},
): BrowserSourceMessage | null {
  const decoded = decodeRecord(value);
  if (!decoded || decoded.v !== BROWSER_SESSION_VERSION) return null;
  const maximumEncodedFrameLength = limits.maximumEncodedFrameLength ?? 24 * 1024 * 1024;
  const maximumViewportDimension = limits.maximumViewportDimension ?? 8192;

  switch (decoded.type) {
    case "source.frame": {
      if (
        decoded.codec !== "image/jpeg" ||
        typeof decoded.data !== "string" ||
        decoded.data.length === 0 ||
        decoded.data.length > maximumEncodedFrameLength ||
        !boundedPositive(decoded.width, maximumViewportDimension) ||
        !boundedPositive(decoded.height, maximumViewportDimension) ||
        (decoded.capturedAt !== undefined && !finite(decoded.capturedAt)) ||
        (decoded.metadata !== undefined && !isRecord(decoded.metadata))
      ) return null;
      return decoded as unknown as BrowserSourceFrameMessage;
    }
    case "source.state":
      return isSourceStatus(decoded.status) &&
        isViewport(decoded.viewport, maximumViewportDimension)
        ? decoded as unknown as BrowserSourceStateMessage
        : null;
    case "source.page":
      return typeof decoded.url === "string" && isHttpUrl(decoded.url)
        ? decoded as unknown as BrowserSourcePageMessage
        : null;
    case "source.activity":
      return validActivity(decoded)
        ? decoded as unknown as BrowserSourceActivityMessage
        : null;
    case "heartbeat":
      return finite(decoded.sentAt)
        ? decoded as unknown as BrowserSessionHeartbeatMessage
        : null;
    default:
      return null;
  }
}

export function parseBrowserViewerMessage(value: unknown): BrowserViewerMessage | null {
  const decoded = decodeRecord(value);
  if (!decoded) return null;
  if (
    decoded.type === "input_mouse" ||
    decoded.type === "input_keyboard" ||
    decoded.type === "input_navigation"
  ) {
    return parseBrowserSessionInput(decoded);
  }
  if (decoded.v !== BROWSER_SESSION_VERSION) return null;
  if (decoded.type === "heartbeat" && finite(decoded.sentAt)) {
    return decoded as unknown as BrowserSessionHeartbeatMessage;
  }
  if (decoded.type !== "client.hello") return null;
  if (decoded.resume !== undefined && !isResumeCursor(decoded.resume)) return null;
  return decoded as unknown as BrowserSessionClientHelloMessage;
}

export function parseBrowserSourceInputMessage(value: unknown): BrowserSourceInputMessage | null {
  const decoded = decodeRecord(value);
  if (
    !decoded ||
    decoded.v !== BROWSER_SESSION_VERSION ||
    decoded.type !== "source.input" ||
    typeof decoded.leaseId !== "string" ||
    !/^[A-Za-z0-9_-]{16,160}$/.test(decoded.leaseId) ||
    typeof decoded.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(decoded.expiresAt))
  ) return null;
  const input = parseBrowserSessionInput(decoded.input);
  return input ? { ...decoded, input } as BrowserSourceInputMessage : null;
}

export function parseBrowserSessionInput(value: unknown): BrowserSessionInputMessage | null {
  if (!isRecord(value)) return null;
  if (value.type === "input_mouse") {
    if (
      !mouseEventType(value.eventType) ||
      !coordinate(value.x) ||
      !coordinate(value.y) ||
      !modifierMask(value.modifiers) ||
      (value.button !== undefined && !mouseButton(value.button)) ||
      (value.clickCount !== undefined && !boundedInteger(value.clickCount, 0, 3)) ||
      (value.deltaX !== undefined && !boundedFinite(value.deltaX, 100_000)) ||
      (value.deltaY !== undefined && !boundedFinite(value.deltaY, 100_000))
    ) return null;
    return value as unknown as BrowserMouseInputMessage;
  }
  if (value.type === "input_keyboard") {
    if (
      !keyboardEventType(value.eventType) ||
      !boundedString(value.key, 256) ||
      !boundedString(value.code, 256) ||
      (value.text !== undefined && !boundedString(value.text, 4096)) ||
      !boundedInteger(value.windowsVirtualKeyCode, 0, 65_535) ||
      !modifierMask(value.modifiers)
    ) return null;
    return value as unknown as BrowserKeyboardInputMessage;
  }
  if (value.type === "input_navigation") {
    return value.direction === "back" || value.direction === "forward"
      ? value as unknown as BrowserNavigationInputMessage
      : null;
  }
  return null;
}

function decodeRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function isResumeCursor(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (value.sourceEpoch === undefined || typeof value.sourceEpoch === "string") &&
    optionalNonNegativeInteger(value.lastEventSequence) &&
    optionalNonNegativeInteger(value.lastFrameSequence);
}

function isViewport(value: unknown, maximum: number): value is BrowserViewportSize {
  return isRecord(value) &&
    boundedPositive(value.width, maximum) &&
    boundedPositive(value.height, maximum);
}

function isSourceStatus(value: unknown): value is BrowserSourceStateMessage["status"] {
  return value === "waiting" || value === "live" || value === "offline";
}

function validActivity(value: Record<string, unknown>): boolean {
  return nonEmptyBoundedString(value.id, 256) &&
    nonEmptyBoundedString(value.action, 128) &&
    nonEmptyBoundedString(value.label, 160) &&
    (value.phase === "started" || value.phase === "completed") &&
    finite(value.timestamp) &&
    (value.agentCursor === undefined || validAgentCursor(value.agentCursor)) &&
    (value.success === undefined || typeof value.success === "boolean") &&
    (value.durationMs === undefined || optionalNonNegativeInteger(value.durationMs));
}

function validAgentCursor(value: unknown): value is BrowserAgentCursorState {
  if (!isRecord(value) || !unitCoordinate(value.x) || !unitCoordinate(value.y)) return false;
  return (value.label === undefined || nonEmptyBoundedString(value.label, 80)) &&
    (value.pressed === undefined || typeof value.pressed === "boolean") &&
    (value.typing === undefined || typeof value.typing === "boolean") &&
    (value.visible === undefined || typeof value.visible === "boolean") &&
    (value.variant === undefined || value.variant === "light" || value.variant === "dark") &&
    (value.size === undefined || boundedFinite(value.size, 256) && value.size > 0) &&
    (value.backgroundColor === undefined || nonEmptyBoundedString(value.backgroundColor, 128));
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function coordinate(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 8192;
}

function unitCoordinate(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function modifierMask(value: unknown): value is number {
  return boundedInteger(value, 0, 15);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
}

function boundedFinite(value: unknown, magnitude: number): value is number {
  return finite(value) && Math.abs(value) <= magnitude;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function nonEmptyBoundedString(value: unknown, maximum: number): value is string {
  return boundedString(value, maximum) && value.length > 0;
}

function mouseEventType(value: unknown): value is BrowserMouseInputMessage["eventType"] {
  return value === "mouseMoved" || value === "mousePressed" ||
    value === "mouseReleased" || value === "mouseWheel";
}

function mouseButton(value: unknown): value is NonNullable<BrowserMouseInputMessage["button"]> {
  return value === "left" || value === "middle" || value === "right" || value === "none";
}

function keyboardEventType(value: unknown): value is BrowserKeyboardInputMessage["eventType"] {
  return value === "keyDown" || value === "keyUp" || value === "char";
}

function boundedPositive(value: unknown, maximum: number): value is number {
  return finite(value) && value > 0 && value <= maximum;
}

function optionalNonNegativeInteger(value: unknown): boolean {
  return value === undefined ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}
