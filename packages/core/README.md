# @browser-ui/core

Runtime-neutral Browser UI contracts for agent-browser protocol messages,
contained coordinate mapping, presentation state, and host-projected access.

This package does not authenticate users or authorize browser input. A host
maps its Nostr, session-cookie, JWT, Better Auth, or other identity into
`BrowserPrincipal` and enforces capabilities and control leases at the stream
gateway. Client-side access state is presentation, never a security boundary.
