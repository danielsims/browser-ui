import type { IncomingMessage } from "node:http";

import type {
  BrowserSessionCapability,
  BrowserSessionDescriptor,
} from "@browser-ui/core";

export interface BrowserGatewayPrincipal {
  id: string;
  kind: "user" | "agent" | "service";
}

export type BrowserGatewayAuthenticationAction =
  | "source:create"
  | "source:connect"
  | "viewer:observe"
  | "viewer:control"
  | "viewer:terminate";

export interface BrowserGatewayAuthorizationContext {
  principal: BrowserGatewayPrincipal;
  session: BrowserSessionDescriptor;
  producer: BrowserGatewayPrincipal;
  capability: BrowserSessionCapability;
}

export type BrowserGatewayAuthenticator = (
  request: IncomingMessage,
  action: BrowserGatewayAuthenticationAction,
) => Promise<BrowserGatewayPrincipal | null> | BrowserGatewayPrincipal | null;

export type BrowserGatewayAuthorizer = (
  context: BrowserGatewayAuthorizationContext,
) => Promise<boolean> | boolean;
