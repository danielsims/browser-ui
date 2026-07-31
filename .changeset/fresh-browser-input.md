---
"@browser-ui/gateway": patch
"@browser-ui/react": patch
---

Keep remote browser input responsive by dropping stale queued frames, forwarding scaled wheel events immediately, and preventing continuous frame decoding from starving canvas updates.
