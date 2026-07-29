# @browser-ui/gateway

A small, application-agnostic browser-session gateway. It accepts one outbound
normalized source connection and fans the latest JPEG frame out to authenticated
viewers.

The package deliberately ships no identity provider. Applications implement
`authenticate` and `authorize`; Better Auth, OAuth, Nostr, and service workload
identity belong in adapters.

Viewer sockets are view-only until the host authorizes `control` and grants that
exact connected client the session's single short-lived lease. The gateway
validates every input event and forwards only the current holder's input to the
source. Heartbeats renew control; disconnect, expiry, or explicit release revoke
it. Source and viewer WebSockets use hashed, short-lived, single-use tickets
carried as subprotocols rather than URLs. The in-memory registry is intended for
one gateway process; distributed routing and durable recording remain deployment
concerns.
