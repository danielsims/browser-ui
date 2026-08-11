export const BROWSER_DRIVER_CONTRACT_VERSION = 1 as const;

export const browserDriverKinds = ["agent-browser", "webkit"] as const;
export type BrowserDriverKind = (typeof browserDriverKinds)[number];

/**
 * Feature units a browser driver can truthfully advertise. Capabilities are
 * additive: UI and agent harnesses must branch on support rather than infer it
 * from a driver's kind.
 */
export const browserDriverCapabilities = [
  "navigation",
  "history",
  "semantic-snapshot",
  "screenshot",
  "element-click",
  "text-input",
  "keyboard-input",
  "script-evaluation",
  "viewport",
  "native-surface",
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
] as const;

export type BrowserDriverCapability =
  (typeof browserDriverCapabilities)[number];

export interface BrowserDriverDescriptor {
  version: typeof BROWSER_DRIVER_CONTRACT_VERSION;
  id: string;
  kind: BrowserDriverKind;
  capabilities: readonly BrowserDriverCapability[];
}

export function isBrowserDriverDescriptor(
  value: unknown,
): value is BrowserDriverDescriptor {
  if (!record(value)) return false;
  if (
    value.version !== BROWSER_DRIVER_CONTRACT_VERSION ||
    !boundedIdentifier(value.id) ||
    !browserDriverKinds.includes(value.kind as BrowserDriverKind) ||
    !Array.isArray(value.capabilities)
  )
    return false;
  const unique = new Set(value.capabilities);
  return (
    unique.size === value.capabilities.length &&
    value.capabilities.every((capability) =>
      browserDriverCapabilities.includes(capability as BrowserDriverCapability),
    )
  );
}

export function createBrowserDriverDescriptor(
  id: string,
  kind: BrowserDriverKind,
  capabilities: readonly BrowserDriverCapability[],
): BrowserDriverDescriptor {
  const descriptor = {
    version: BROWSER_DRIVER_CONTRACT_VERSION,
    id,
    kind,
    capabilities: [...capabilities],
  } as const;
  if (!isBrowserDriverDescriptor(descriptor)) {
    throw new TypeError("Invalid browser driver descriptor.");
  }
  return descriptor;
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
