---
"@browser-ui/core": patch
"@browser-ui/gateway": patch
"@browser-ui/react": patch
---

Keep remote browser sessions responsive by dropping stale queued frames, forwarding scaled wheel events immediately, preventing continuous frame decoding from starving canvas updates, keeping chat commands on the streamed daemon configuration, and resolving a fresh agent-browser stream endpoint after local stream restarts. Relay safe, structured agent activity labels and normalized cursor positions through the session protocol so Browser UI can present live progress without exposing command values.
