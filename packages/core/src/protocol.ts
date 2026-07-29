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
