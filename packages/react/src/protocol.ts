export interface BrowserFrameMetadata {
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  offsetTop: number;
  scrollOffsetX: number;
  scrollOffsetY: number;
}

export interface BrowserFrame {
  type: "frame";
  data: string;
  metadata: BrowserFrameMetadata;
}

export interface BrowserStreamStatus {
  type: "status";
  connected: boolean;
  screencasting: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

export interface BrowserUrlChange { type: "url"; url: string }

export type BrowserCursor =
  | "default" | "pointer" | "text" | "vertical-text" | "crosshair"
  | "move" | "grab" | "grabbing" | "not-allowed" | "wait"
  | "progress" | "help" | "zoom-in" | "zoom-out" | "col-resize"
  | "row-resize" | "nwse-resize" | "nesw-resize";

export interface BrowserCursorChange { type: "cursor"; cursor: BrowserCursor }

export type BrowserStreamMessage =
  | BrowserFrame
  | BrowserStreamStatus
  | BrowserUrlChange
  | BrowserCursorChange;

export type BrowserViewportStatus = "connecting" | "connected" | "disconnected" | "error";

export interface BrowserKeyboardEventLike {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export interface BrowserKeyboardInput {
  type: "input_keyboard";
  eventType: "keyDown" | "keyUp";
  key: string;
  code: string;
  text?: string;
  windowsVirtualKeyCode: number;
  modifiers: number;
}

const KEY_INFO: Record<string, { text?: string; keyCode: number }> = {
  Enter: { text: "\r", keyCode: 13 }, Tab: { text: "\t", keyCode: 9 },
  Backspace: { text: "\b", keyCode: 8 }, Escape: { keyCode: 27 },
  ArrowLeft: { keyCode: 37 }, ArrowUp: { keyCode: 38 }, ArrowRight: { keyCode: 39 },
  ArrowDown: { keyCode: 40 }, Delete: { keyCode: 46 }, Home: { keyCode: 36 },
  End: { keyCode: 35 }, PageUp: { keyCode: 33 }, PageDown: { keyCode: 34 },
};

const CODE_KEY_CODES: Record<string, number> = {
  Semicolon: 186, Equal: 187, Comma: 188, Minus: 189, Period: 190,
  Slash: 191, Backquote: 192, BracketLeft: 219, Backslash: 220,
  BracketRight: 221, Quote: 222, NumpadMultiply: 106, NumpadAdd: 107,
  NumpadSubtract: 109, NumpadDecimal: 110, NumpadDivide: 111,
};

function windowsVirtualKeyCode(event: BrowserKeyboardEventLike) {
  const configured = KEY_INFO[event.key]?.keyCode ?? CODE_KEY_CODES[event.code];
  if (configured !== undefined) return configured;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.charCodeAt(5);
  if (/^Numpad[0-9]$/.test(event.code)) return 96 + Number(event.code.at(-1));
  return event.key.length === 1 ? event.key.toUpperCase().charCodeAt(0) : 0;
}

export function browserKeyboardInput(
  event: BrowserKeyboardEventLike,
  eventType: "keyDown" | "keyUp",
): BrowserKeyboardInput {
  const info = KEY_INFO[event.key];
  const text = eventType === "keyDown"
    ? (info?.text ?? (event.key.length === 1 ? event.key : undefined))
    : undefined;
  return {
    type: "input_keyboard", eventType, key: event.key, code: event.code, text,
    windowsVirtualKeyCode: windowsVirtualKeyCode(event),
    modifiers: (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0)
      | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0),
  };
}
