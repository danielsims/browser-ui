# @browser-ui/source-agent-browser

Connects the loopback-only `agent-browser` WebSocket to a Browser UI gateway by
opening an authenticated outbound source connection. The raw automation socket
and CDP endpoint are never published.

Frames are decoded from the local JSON/base64 stream once, then forwarded as
binary JPEG envelopes with per-frame sequence and capture timestamps. The
adapter keeps at most one unsent frame, disables redundant WebSocket compression,
and reconnects both gateway and local source with fresh gateway tickets. Slow
WAN links therefore drop intermediate full frames instead of accumulating lag.

The source adapter forwards only gateway-validated `source.input` envelopes to
the loopback agent-browser stream. The gateway remains responsible for
authentication, the exclusive control lease, expiry, and input validation.

The CLI starts a detached relay worker, prints the credential-free version 2
session descriptor, and exits. Pass `--foreground` when a process supervisor
should own the relay worker directly.
