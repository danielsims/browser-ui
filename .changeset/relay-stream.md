---
"@browser-ui/core": minor
"@browser-ui/react": minor
---

Relay streams: browser sessions can stream their screen as H.264 and their sound as Opus on the session's WebSocket. `@browser-ui/core` adds the protocol (`parseRelayHello`, `parseRelayVideoHeader`, `relayCommand`); the React viewport plays it with WebCodecs only while it's on screen, and `Browser` takes `sound` and `onSoundAvailable`. Viewers can send touch input (`input_touch`). The agent cursor glides in from its parked position, and ending a session is a labelled button. The Swift package gains `BrowserStreamDriver` and `BrowserStreamView` for the same streams.
