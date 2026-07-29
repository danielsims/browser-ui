/** A host-authenticated identity presented in browser-session UI. */
export interface BrowserPrincipal {
  id: string;
  displayName: string;
  kind: "user" | "agent" | "service";
  avatarUrl?: string;
}

/** Capabilities the session gateway, not the UI, must enforce. */
export type BrowserSessionCapability =
  | "observe"
  | "control"
  | "manage"
  | "terminate";

export type BrowserSessionVisibility =
  | "owner-only"
  | "channel"
  | "explicit";

export interface BrowserAudienceRule {
  scope: BrowserSessionVisibility;
  principalIds?: readonly string[];
}

/** Portable policy input for host-owned access editors. */
export interface BrowserSessionPolicy {
  observe: BrowserAudienceRule;
  control: BrowserAudienceRule;
  allowControlRequests: boolean;
  sensitiveMode: "owner-only" | "explicit";
}

/** Host-projected access state. It deliberately contains no auth mechanism. */
export interface BrowserSessionAccess {
  owner: BrowserPrincipal;
  viewer: BrowserPrincipal;
  visibility: BrowserSessionVisibility;
  capabilities: readonly BrowserSessionCapability[];
  observers?: readonly BrowserPrincipal[];
  controller?: BrowserPrincipal;
  lease?: BrowserControlLease;
  sensitive?: boolean;
  policy?: BrowserSessionPolicy;
}

/** A short-lived, server-authoritative exclusive browser-control lease. */
export interface BrowserControlLease {
  id: string;
  holder: BrowserPrincipal;
  expiresAt: string;
  renewable: boolean;
}

export type BrowserControlState =
  | "unavailable"
  | "available"
  | "requesting"
  | "controlling"
  | "controlled-by-other";

export function browserControlState(
  access: BrowserSessionAccess,
): BrowserControlState {
  if (!access.capabilities.includes("control")) return "unavailable";
  if (!access.controller) return "available";
  return access.controller.id === access.viewer.id
    ? "controlling"
    : "controlled-by-other";
}

export function canManageBrowserControl(access: BrowserSessionAccess): boolean {
  return access.capabilities.includes("manage");
}

/** Client-side input gate. The gateway must independently enforce the lease. */
export function canSendBrowserInput(access: BrowserSessionAccess): boolean {
  const leaseExpiry = access.lease ? Date.parse(access.lease.expiresAt) : Number.NaN;
  return access.sensitive !== true &&
    access.capabilities.includes("control") &&
    access.controller?.id === access.viewer.id &&
    access.lease?.holder.id === access.viewer.id &&
    Number.isFinite(leaseExpiry) &&
    leaseExpiry > Date.now();
}
