"use client";

export { AgentBrowser, Browser } from "./browser";
export type { AgentBrowserProps, BrowserProps } from "./browser";
export { BrowserRecording } from "./browser-recording";
export type {
  BrowserRecordingProps,
  BrowserRecordingTimelineEvent,
} from "./browser-recording";
export {
  BrowserDisplayControls,
  BrowserDisplayTrigger,
  BrowserEndSessionTrigger,
  BrowserFullscreenTrigger,
  BrowserPictureInPictureTrigger,
} from "./browser-display";
export type {
  BrowserDisplayControlsProps,
  BrowserDisplayMode,
  BrowserDisplayTriggerProps,
  BrowserEndSessionTriggerProps,
  BrowserFullscreenTriggerProps,
  BrowserPictureInPictureTriggerProps,
} from "./browser-display";
export { BrowserRoot } from "./browser-root";
export type {
  BrowserColorScheme,
  BrowserRootProps,
  BrowserVariant,
} from "./browser-root";
export { BrowserSurface, BrowserLoading } from "./browser-surface";
export type {
  BrowserSurfaceProps,
  BrowserLoadingProps,
} from "./browser-surface";
export { BrowserToolbar } from "./browser-toolbar";
export type { BrowserToolbarProps } from "./browser-toolbar";
export { AgentBrowserViewport } from "./agent-browser-viewport";
export type {
  AgentBrowserViewportProps,
  BrowserViewportSize,
} from "./agent-browser-viewport";
export { BrowserOperatingOverlay } from "./operating-overlay";
export type { BrowserOperatingOverlayProps } from "./operating-overlay";
export {
  BrowserOperatingShader,
  browserOperatingShaderDirections,
  browserOperatingShaderSpeeds,
  browserOperatingShaderVariants,
} from "./operating-shader";
export type {
  BrowserOperatingShaderDirection,
  BrowserOperatingShaderOptions,
  BrowserOperatingShaderProps,
  BrowserOperatingShaderSpeed,
  BrowserOperatingShaderVariant,
} from "./operating-shader";
export { BrowserAgentCursor } from "./agent-cursor";
export type {
  BrowserAgentCursorProps,
  BrowserAgentCursorState,
  BrowserAgentCursorVariant,
} from "./agent-cursor";
export {
  BrowserAccessRoot,
  BrowserAudienceOption,
  BrowserControlStatus,
  BrowserControlTrigger,
  BrowserObserverList,
  BrowserPolicyRoot,
  BrowserPrincipalGrantTrigger,
  useBrowserAccess,
} from "./browser-access";
export type {
  BrowserAccessRootProps,
  BrowserAudienceOptionProps,
  BrowserControlStatusProps,
  BrowserControlTriggerProps,
  BrowserObserverListProps,
  BrowserPolicyRootProps,
  BrowserPrincipalGrantTriggerProps,
} from "./browser-access";
export type {
  BrowserAgentActivity,
  BrowserAudienceRule,
  BrowserControlLease,
  BrowserControlState,
  BrowserPrincipal,
  BrowserSessionAccess,
  BrowserSessionCapability,
  BrowserSessionPolicy,
  BrowserSessionVisibility,
} from "@browser-ui/core";
export { browserKeyboardInput } from "./protocol";
export { parseAgentBrowserMessage } from "./protocol";
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
  BrowserCursor,
  BrowserCursorChange,
  BrowserFrame,
  BrowserFrameMetadata,
  BrowserKeyboardEventLike,
  BrowserKeyboardInput,
  BrowserStreamMessage,
  BrowserStreamStatus,
  BrowserUrlChange,
  BrowserViewportStatus,
} from "./protocol";
