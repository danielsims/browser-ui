# Browser UI

Composable web, Expo, and Flutter UI for the official
[`agent-browser`](https://github.com/vercel-labs/agent-browser) WebSocket stream.
Browser UI renders live or recorded browser sessions and emits input while the
host owns the browser process, authentication, authorization, and lifecycle.

## Demo

The default documentation uses recorded previews. Start a genuine local
`agent-browser` session with `pnpm dev:live`; there is no iframe or hard-coded
page implementation.

```sh
nvm use
pnpm install
pnpm dev:live
```

The workflow finds Mac mini, configures M4 with 24GB memory and 512GB storage,
then stops at the final add-to-bag review. Taking control cancels the workflow
before enabling pointer, wheel, keyboard, and paste input.

The documentation controls `mode` with an `IntersectionObserver`: scrolling the
inline preview fully above the viewport moves the same live session into PiP,
and returning to the preview animates it back into place.

The demo plays bundled agent-browser workflow captures through
`BrowserRecording` by default. They are served as static assets by the
deployment, so the repository can remain private and visitors do not create an
agent-browser session. Set `NEXT_PUBLIC_BROWSER_DEMO_MODE=live` together with
`NEXT_PUBLIC_BROWSER_STREAM_URL` to run the live, takeover-capable demo.

## React integration

```tsx
import { Browser } from "@browser-ui/react";
import "@browser-ui/react/styles.css"; // Optional reference theme.

<Browser
  streamUrl={session.streamUrl}
  viewportSize={{ width: 1440, height: 900 }}
  url={session.url}
  operating={session.agentActive}
  operatingLabel={session.currentTask}
  agentCursor={session.agentCursor}
  showPictureInPicture
  showFullscreen
  onTakeControl={session.takeControl}
  onUrlChange={session.reportUrl}
  onViewportResize={session.resize}
/>
```

The host owns the `agent-browser` process, navigation, resizing, and agent
control state. `Browser` owns only the interactive stream client and its UI.

## Recorded playback

`agent-browser record start ./workflow.webm` and `agent-browser record stop`
produce native WebM artifacts. Use `BrowserRecording` to review a completed
workflow with the same Browser UI frame and display modes, but without
misrepresenting a static recording as a live input session:

```tsx
import { BrowserRecording } from "@browser-ui/react";

<BrowserRecording
  src="/workflows/checkout.webm"
  viewportSize={{ width: 1440, height: 900 }}
  showPictureInPicture
  showFullscreen
  videoProps={{ controls: true }}
/>
```

Lower-level `AgentBrowserViewport`, `BrowserSurface`, and
`BrowserOperatingOverlay` exports are available for custom composition.
`BrowserAgentCursor` accepts normalized coordinates plus pressed, typing,
visibility, label, and light/dark appearance state.

The full primitive API is:

```tsx
<BrowserRoot variant="framed">
  <BrowserToolbar {...navigation} />
  <BrowserSurface overlay={<BrowserOperatingOverlay {...agent} />}>
    <AgentBrowserViewport
      streamUrl={session.streamUrl}
      viewportSize={{ width: 1440, height: 900 }}
    />
  </BrowserSurface>
  <BrowserDisplayControls>
    <BrowserPictureInPictureTrigger />
    <BrowserFullscreenTrigger />
  </BrowserDisplayControls>
</BrowserRoot>
```

Browser UI owns the React interface. The separate `agent-browser` package owns
the browser process and transport.

## Access control

Observation, control, management, and termination are separate capabilities.
Browser UI provides host-neutral principals and headless control-lease
primitives, but the stream gateway must enforce authorization for every input.

```tsx
<BrowserAccessRoot
  access={session.access}
  onRequestControl={session.requestControl}
  onReleaseControl={session.releaseControl}
>
  <Browser streamUrl={session.streamUrl} protocols={session.protocols} />
  <BrowserControlStatus />
  <BrowserControlTrigger />
</BrowserAccessRoot>
```

See [the architecture and security model](./docs/architecture.md) for Nostr,
cookie-session, JWT, channel sharing, sensitive-mode, and gateway guidance.

`viewportSize` controls the remote browser resolution. Component width and
`displayAspectRatio` control only its presentation, so a desktop page can remain
1440 × 900 while rendered inline, in a 440px picture-in-picture window, or
fullscreen. `BrowserRoot` exposes those layouts as the composable `mode` values
`inline`, `picture-in-picture`, and `fullscreen`.
Use `fullscreenTarget` to make fullscreen fill a specific host element instead
of the complete viewport; Browser UI follows that element's live bounds and
border radius.

## Packages

- `@browser-ui/core`: protocol, geometry, cursor, recording, and access types.
- `@browser-ui/react`: web canvas, browser chrome, recordings, and primitives.
- `@browser-ui/react-native`: Expo-compatible viewer and native browser sheet.
- `packages/flutter`: Dart controller, viewer, and native browser sheet.

A phone can consume a reachable stream directly. Localhost points at the phone,
so collaborative mobile sessions normally resolve an opaque session ID through
an authenticated `wss://` gateway.
