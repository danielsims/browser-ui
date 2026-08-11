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

export interface BrowserAgentActivity {
  id: string;
  action: string;
  label: string;
  phase: "started" | "completed";
  timestamp: number;
  /** Optional normalized cursor position associated with this action. */
  agentCursor?: BrowserAgentCursorState;
  success?: boolean;
  durationMs?: number;
}

export interface BrowserRecordingTimelineEvent {
  at: number;
  agentCursor?: BrowserAgentCursorState;
  operatingLabel?: string;
}

export type BrowserViewportStatus =
  "connecting" | "connected" | "disconnected" | "error";
