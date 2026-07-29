export {
  browserKeyboardInput,
  mapContainedPointToViewport,
  parseAgentBrowserMessage,
} from "@browser-ui/core";
export type {
  AgentBrowserCommandMessage,
  AgentBrowserConsoleMessage,
  AgentBrowserCursorMessage,
  AgentBrowserErrorMessage,
  AgentBrowserFrameMessage,
  AgentBrowserFrameMetadata,
  AgentBrowserIncomingMessage,
  AgentBrowserKeyboardInput,
  AgentBrowserPageErrorMessage,
  AgentBrowserResultMessage,
  AgentBrowserStatusMessage,
  AgentBrowserTabInfo,
  AgentBrowserTabsMessage,
  AgentBrowserUrlMessage,
  BrowserKeyboardEventLike,
  BrowserViewportStatus,
} from "@browser-ui/core";

// Compatibility aliases retained for the published 0.x React API.
export type {
  AgentBrowserFrameMetadata as BrowserFrameMetadata,
  AgentBrowserFrameMessage as BrowserFrame,
  AgentBrowserIncomingMessage as BrowserStreamMessage,
  AgentBrowserKeyboardInput as BrowserKeyboardInput,
  AgentBrowserStatusMessage as BrowserStreamStatus,
  AgentBrowserUrlMessage as BrowserUrlChange,
  AgentBrowserCursorMessage as BrowserCursorChange,
} from "@browser-ui/core";

export type BrowserCursor = string;
