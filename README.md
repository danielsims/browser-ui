# Browser UI

An interactive React component for the official
[`agent-browser`](https://github.com/vercel-labs/agent-browser) WebSocket stream.
It renders the live browser viewport and sends pointer, keyboard, paste, wheel,
and viewport input back to the same session.

## Demo

The documentation starts one genuine local `agent-browser` session. The Apple
workflow runs a deterministic action timeline against that live browser; there
is no iframe or hard-coded Apple page implementation.

```sh
nvm use
pnpm install
pnpm dev
```

The workflow finds Mac mini, configures M4 with 24GB memory and 512GB storage,
then stops at the final add-to-bag review. Taking control cancels the workflow
before enabling pointer, wheel, keyboard, and paste input.

The documentation controls `mode` with an `IntersectionObserver`: scrolling the
inline preview fully above the viewport moves the same live session into PiP,
and returning to the preview animates it back into place.

## React integration

```tsx
import { Browser } from "@browser-ui/react";

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

`viewportSize` controls the remote browser resolution. Component width and
`displayAspectRatio` control only its presentation, so a desktop page can remain
1440 × 900 while rendered inline, in a 440px picture-in-picture window, or
fullscreen. `BrowserRoot` exposes those layouts as the composable `mode` values
`inline`, `picture-in-picture`, and `fullscreen`.

## Direction

Browser UI begins as a React web component. Future work will explore native
mobile and Expo-friendly sheet presentations, alongside Safari-backed browser
sessions, without locking those surfaces into the current API.
