import { createHash, randomBytes } from "node:crypto";
import type { BrowserSessionCapability } from "@browser-ui/session";

export interface BrowserGatewayTicketClaims {
  role: "source" | "viewer";
  sessionId: string;
  principalId: string;
  clientInstanceId?: string;
  capabilities?: readonly BrowserSessionCapability[];
  frameEncoding?: "binary-jpeg" | "json-base64";
}

interface StoredTicket extends BrowserGatewayTicketClaims {
  expiresAt: number;
}

export interface IssuedBrowserGatewayTicket {
  protocol: string;
  expiresAt: string;
}

export class OneTimeBrowserGatewayTickets {
  readonly #tickets = new Map<string, StoredTicket>();
  readonly #lifetimeMs: number;

  constructor(lifetimeMs = 30_000) {
    if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1_000) {
      throw new Error("Ticket lifetime must be at least one second.");
    }
    this.#lifetimeMs = lifetimeMs;
  }

  issue(claims: BrowserGatewayTicketClaims): IssuedBrowserGatewayTicket {
    this.#removeExpired();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + this.#lifetimeMs;
    this.#tickets.set(hash(token), { ...claims, expiresAt });
    return {
      protocol: `ticket.${token}`,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  consume(protocols: readonly string[], role: StoredTicket["role"]): BrowserGatewayTicketClaims | null {
    const ticketProtocol = protocols.find((protocol) => protocol.startsWith("ticket."));
    if (!ticketProtocol) return null;
    const token = ticketProtocol.slice("ticket.".length);
    if (!token) return null;
    const key = hash(token);
    const ticket = this.#tickets.get(key);
    this.#tickets.delete(key);
    if (!ticket || ticket.role !== role || ticket.expiresAt <= Date.now()) return null;
    const { expiresAt: _expiresAt, ...claims } = ticket;
    return claims;
  }

  #removeExpired() {
    const now = Date.now();
    for (const [key, ticket] of this.#tickets) {
      if (ticket.expiresAt <= now) this.#tickets.delete(key);
    }
  }
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
