import type { BrowserAgentActivity } from "./presentation.js";

export interface AgentBrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
  timestamp?: number;
}

export interface AgentBrowserFrameMessage {
  type: "frame";
  data: string;
  metadata: AgentBrowserFrameMetadata;
}

export interface AgentBrowserStatusMessage {
  type: "status";
  connected: boolean;
  screencasting: boolean;
  viewportWidth: number;
  viewportHeight: number;
  engine?: string;
  recording?: boolean;
}

export interface AgentBrowserUrlMessage {
  type: "url";
  url: string;
  timestamp?: number;
}

export interface AgentBrowserCommandMessage {
  type: "command";
  action: string;
  id: string;
  params: Record<string, unknown>;
  timestamp: number;
}

export interface AgentBrowserResultMessage {
  type: "result";
  id: string;
  action: string;
  success: boolean;
  data: unknown;
  duration_ms: number;
  timestamp: number;
}

export interface BrowserSessionActivityMessage extends BrowserAgentActivity {
  type: "activity";
  v: 1;
  eventSequence: number;
}

export interface AgentBrowserConsoleMessage {
  type: "console";
  level: string;
  text: string;
  timestamp: number;
}

export interface AgentBrowserPageErrorMessage {
  type: "page_error";
  text: string;
  line: number | null;
  column: number | null;
  timestamp: number;
}

export interface AgentBrowserErrorMessage {
  type: "error";
  message: string;
}

export interface AgentBrowserTabInfo {
  tabId: string;
  label?: string | null;
  title: string;
  url: string;
  type: string;
  active: boolean;
}

export interface AgentBrowserTabsMessage {
  type: "tabs";
  tabs: AgentBrowserTabInfo[];
  timestamp: number;
}

/** Optional Browser UI extension used by host-recorded agent cursors. */
export interface AgentBrowserCursorMessage {
  type: "cursor";
  cursor: string;
}

export type AgentBrowserIncomingMessage =
  | AgentBrowserFrameMessage
  | AgentBrowserStatusMessage
  | AgentBrowserUrlMessage
  | AgentBrowserCommandMessage
  | AgentBrowserResultMessage
  | BrowserSessionActivityMessage
  | AgentBrowserConsoleMessage
  | AgentBrowserPageErrorMessage
  | AgentBrowserErrorMessage
  | AgentBrowserTabsMessage
  | AgentBrowserCursorMessage;

/** Parses supported messages and rejects malformed or unknown input safely. */
export function parseAgentBrowserMessage(
  value: unknown,
): AgentBrowserIncomingMessage | null {
  let decoded = value;
  if (typeof value === "string") {
    try {
      decoded = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isRecord(decoded) || typeof decoded.type !== "string") return null;

  switch (decoded.type) {
    case "frame":
      return parseFrame(decoded);
    case "status":
      return parseStatus(decoded);
    case "url":
      return typeof decoded.url === "string" && optionalNumber(decoded.timestamp)
        ? decoded as unknown as AgentBrowserUrlMessage
        : null;
    case "cursor":
      return typeof decoded.cursor === "string"
        ? decoded as unknown as AgentBrowserCursorMessage
        : null;
    case "command":
      return stringFields(decoded, "action", "id") &&
        isRecord(decoded.params) && finite(decoded.timestamp)
        ? decoded as unknown as AgentBrowserCommandMessage
        : null;
    case "result":
      return stringFields(decoded, "id", "action") &&
        typeof decoded.success === "boolean" &&
        finite(decoded.duration_ms) && finite(decoded.timestamp)
        ? decoded as unknown as AgentBrowserResultMessage
        : null;
    case "activity":
      return parseActivity(decoded);
    case "console":
      return stringFields(decoded, "level", "text") && finite(decoded.timestamp)
        ? decoded as unknown as AgentBrowserConsoleMessage
        : null;
    case "page_error":
      return typeof decoded.text === "string" &&
        nullableFinite(decoded.line) && nullableFinite(decoded.column) &&
        finite(decoded.timestamp)
        ? decoded as unknown as AgentBrowserPageErrorMessage
        : null;
    case "error":
      return typeof decoded.message === "string"
        ? decoded as unknown as AgentBrowserErrorMessage
        : null;
    case "tabs":
      return Array.isArray(decoded.tabs) && decoded.tabs.every(isTab) &&
        finite(decoded.timestamp)
        ? decoded as unknown as AgentBrowserTabsMessage
        : null;
    default:
      return null;
  }
}

/**
 * Produces a concise, safe status label from an agent-browser command.
 * User-entered values are intentionally never included.
 */
export function describeAgentBrowserCommand(
  action: string,
  params: Record<string, unknown>,
): string {
  const normalized = action.toLowerCase().replaceAll("_", "").replaceAll("-", "");
  switch (normalized) {
    case "open":
    case "goto":
    case "navigate":
      return destinationLabel(params.url);
    case "back":
      return "Going back";
    case "forward":
      return "Going forward";
    case "reload":
      return "Reloading the page";
    case "click":
    case "dblclick":
      return "Clicking an element";
    case "fill":
    case "type":
      return "Entering text";
    case "press":
      return typeof params.key === "string" && params.key.length <= 32
        ? `Pressing ${params.key}`
        : "Pressing a key";
    case "hover":
      return "Inspecting an element";
    case "select":
      return "Selecting an option";
    case "check":
      return "Checking an option";
    case "uncheck":
      return "Unchecking an option";
    case "scroll":
    case "scrollintoview":
      return "Scrolling the page";
    case "snapshot":
    case "getcontent":
    case "gettext":
    case "gethtml":
    case "getvalue":
      return "Reading the page";
    case "screenshot":
      return "Capturing the page";
    case "wait":
    case "waitforurl":
    case "waitforloadstate":
    case "waitforfunction":
    case "waitfordownload":
      return "Waiting for the page";
    case "tabs":
    case "tablist":
    case "tabnew":
    case "tabswitch":
    case "tabclose":
      return "Managing browser tabs";
    default:
      return `Running ${humanizeAction(action)}`;
  }
}

function parseActivity(value: Record<string, unknown>): BrowserSessionActivityMessage | null {
  return value.v === 1 &&
    typeof value.id === "string" &&
    typeof value.action === "string" &&
    typeof value.label === "string" &&
    value.id.length > 0 &&
    value.action.length > 0 &&
    value.label.length > 0 &&
    value.id.length <= 256 &&
    value.action.length <= 128 &&
    value.label.length <= 160 &&
    (value.phase === "started" || value.phase === "completed") &&
    finite(value.timestamp) &&
    nonNegativeInteger(value.eventSequence) &&
    (value.agentCursor === undefined || validAgentCursor(value.agentCursor)) &&
    (value.success === undefined || typeof value.success === "boolean") &&
    (value.durationMs === undefined || nonNegativeInteger(value.durationMs))
    ? value as unknown as BrowserSessionActivityMessage
    : null;
}

function validAgentCursor(value: unknown): boolean {
  if (!isRecord(value) || !unitCoordinate(value.x) || !unitCoordinate(value.y)) return false;
  return (value.label === undefined || boundedNonEmptyString(value.label, 80)) &&
    (value.pressed === undefined || typeof value.pressed === "boolean") &&
    (value.typing === undefined || typeof value.typing === "boolean") &&
    (value.visible === undefined || typeof value.visible === "boolean") &&
    (value.variant === undefined || value.variant === "light" || value.variant === "dark") &&
    (value.size === undefined || finite(value.size) && value.size > 0 && value.size <= 256) &&
    (value.backgroundColor === undefined || boundedNonEmptyString(value.backgroundColor, 128));
}

function destinationLabel(value: unknown): string {
  if (typeof value !== "string") return "Opening a page";
  try {
    const hostname = new URL(value.includes("://") ? value : `https://${value}`).hostname;
    return hostname ? `Opening ${hostname}` : "Opening a page";
  } catch {
    return "Opening a page";
  }
}

function humanizeAction(action: string): string {
  const words = action
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim()
    .toLowerCase();
  return words || "browser action";
}

function parseFrame(value: Record<string, unknown>): AgentBrowserFrameMessage | null {
  if (typeof value.data !== "string" || !isRecord(value.metadata)) return null;
  const metadata = value.metadata;
  if (
    !positive(metadata.deviceWidth) ||
    !positive(metadata.deviceHeight) ||
    !finite(metadata.pageScaleFactor) ||
    !finite(metadata.offsetTop) ||
    !finite(metadata.scrollOffsetX) ||
    !finite(metadata.scrollOffsetY) ||
    !optionalNumber(metadata.timestamp)
  ) return null;
  return value as unknown as AgentBrowserFrameMessage;
}

function parseStatus(value: Record<string, unknown>): AgentBrowserStatusMessage | null {
  return typeof value.connected === "boolean" &&
    typeof value.screencasting === "boolean" &&
    positive(value.viewportWidth) && positive(value.viewportHeight) &&
    (value.engine === undefined || typeof value.engine === "string") &&
    (value.recording === undefined || typeof value.recording === "boolean")
    ? value as unknown as AgentBrowserStatusMessage
    : null;
}

function isTab(value: unknown): value is AgentBrowserTabInfo {
  return isRecord(value) &&
    stringFields(value, "tabId", "title", "url", "type") &&
    (value.label === undefined || value.label === null || typeof value.label === "string") &&
    typeof value.active === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function unitCoordinate(value: unknown): value is number {
  return finite(value) && value >= 0 && value <= 1;
}

function boundedNonEmptyString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0;
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function optionalNumber(value: unknown): boolean {
  return value === undefined || finite(value);
}

function nullableFinite(value: unknown): boolean {
  return value === null || finite(value);
}

function stringFields(
  value: Record<string, unknown>,
  ...fields: string[]
): boolean {
  return fields.every((field) => typeof value[field] === "string");
}
