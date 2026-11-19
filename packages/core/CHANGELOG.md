# @browser-ui/core

## 0.4.0

### Minor Changes

- e18dc6f: Relay streams: browser sessions can stream their screen as H.264 and their sound as Opus on the session's WebSocket. `@browser-ui/core` adds the protocol (`parseRelayHello`, `parseRelayVideoHeader`, `relayCommand`); the React viewport plays it with WebCodecs only while it's on screen, and `Browser` takes `sound` and `onSoundAvailable`. Viewers can send touch input (`input_touch`). The agent cursor glides in from its parked position, and ending a session is a labelled button. The Swift package gains `BrowserStreamDriver` and `BrowserStreamView` for the same streams.

## 0.3.1

## 0.3.0

### Minor Changes

- 763879c: Add portable browser-session handoff and termination contracts with authenticated gateway termination and cross-platform controls.

### Patch Changes

- a392728: Keep remote browser sessions responsive by dropping stale queued frames, forwarding scaled wheel events immediately, preventing continuous frame decoding from starving canvas updates, keeping chat commands on the streamed daemon configuration, and resolving a fresh agent-browser stream endpoint after local stream restarts. Relay safe, structured agent activity labels and normalized cursor positions through the session protocol so Browser UI can present live progress without exposing command values.
