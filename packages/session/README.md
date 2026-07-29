# @browser-ui/session

Vendor-neutral session descriptors, wire messages, and authenticated connection
resolution for remote browser viewers.

Applications provide authentication. The resolver exchanges that application
credential over HTTPS for a short-lived WebSocket ticket. Durable messages must
contain only an opaque `sessionId` and credential-free metadata.

The v1 frame envelope is additive-compatible with Browser UI's existing
`agent-browser` viewers. Browser runtimes remain behind source adapters; clients
do not receive CDP endpoints or raw automation sockets.
