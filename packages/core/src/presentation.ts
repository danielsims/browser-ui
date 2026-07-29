export type BrowserAgentCursorVariant = "light" | "dark";

export interface BrowserAgentCursorState {
  x: number;
  y: number;
  label?: string;
  pressed?: boolean;
  typing?: boolean;
  visible?: boolean;
  variant?: BrowserAgentCursorVariant;
  size?: number;
  backgroundColor?: string;
}

export interface BrowserRecordingTimelineEvent {
  at: number;
  agentCursor?: BrowserAgentCursorState;
  operatingLabel?: string;
}

export type BrowserViewportStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
