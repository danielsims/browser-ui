import type { BrowserDriverCapability } from "@browser-ui/core";
import { createBrowserDriverDescriptor } from "@browser-ui/core";

/**
 * Automation capabilities exposed by upstream agent-browser. The relay uses
 * its streaming surface while agent harnesses continue to invoke the upstream
 * CLI or MCP command layer directly.
 */
export const agentBrowserDriverCapabilities = [
  "navigation",
  "history",
  "semantic-snapshot",
  "screenshot",
  "element-click",
  "text-input",
  "keyboard-input",
  "script-evaluation",
  "viewport",
  "remote-frame-stream",
  "pointer-input",
  "wait",
  "scroll",
  "hover",
  "drag-and-drop",
  "selection",
  "tabs",
  "dialogs",
  "downloads",
  "uploads",
  "cookies",
  "storage",
  "network-inspection",
  "console",
  "pdf",
  "recording",
] as const satisfies readonly BrowserDriverCapability[];

export const agentBrowserDriverDescriptor = createBrowserDriverDescriptor(
  "agent_browser_remote",
  "agent-browser",
  agentBrowserDriverCapabilities,
);
