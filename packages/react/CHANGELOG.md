# @browser-ui/react

## 0.4.0

### Minor Changes

- e18dc6f: Relay streams: browser sessions can stream their screen as H.264 and their sound as Opus on the session's WebSocket. `@browser-ui/core` adds the protocol (`parseRelayHello`, `parseRelayVideoHeader`, `relayCommand`); the React viewport plays it with WebCodecs only while it's on screen, and `Browser` takes `sound` and `onSoundAvailable`. Viewers can send touch input (`input_touch`). The agent cursor glides in from its parked position, and ending a session is a labelled button. The Swift package gains `BrowserStreamDriver` and `BrowserStreamView` for the same streams.

### Patch Changes

- Updated dependencies [e18dc6f]
  - @browser-ui/core@0.4.0
  - @browser-ui/shaders@0.4.0

## 0.3.1

### Patch Changes

- @browser-ui/core@0.3.1
- @browser-ui/shaders@0.3.1

## 0.3.0

### Minor Changes

- 763879c: Add portable browser-session handoff and termination contracts with authenticated gateway termination and cross-platform controls.
- 4dfe85a: Add configurable Prism, Pulse, and Tide operating shaders with cardinal and diagonal directions, tasteful speed presets, and smooth wrapped loops.

### Patch Changes

- f0fea4f: Constrain picture-in-picture viewers to a host-provided container, enter at a predictable bottom-right resting point, preserve one Motion layout across inline and floating modes, and support whole-surface spring dragging between configurable snap points.
- a392728: Keep remote browser sessions responsive by dropping stale queued frames, forwarding scaled wheel events immediately, preventing continuous frame decoding from starving canvas updates, keeping chat commands on the streamed daemon configuration, and resolving a fresh agent-browser stream endpoint after local stream restarts. Relay safe, structured agent activity labels and normalized cursor positions through the session protocol so Browser UI can present live progress without exposing command values.
- Updated dependencies [a392728]
- Updated dependencies [763879c]
- Updated dependencies [4dfe85a]
  - @browser-ui/core@0.3.0
  - @browser-ui/shaders@0.3.0
