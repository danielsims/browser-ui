# @browser-ui/react

A composable browser surface for React. It supports live
[`agent-browser`](https://github.com/vercel-labs/agent-browser) pair-browsing
sessions and native WebM recordings, while keeping workflow ownership in the
host application.

## Install

```sh
npm install @browser-ui/react
```

## Usage

```tsx
import { Browser } from "@browser-ui/react";
import "@browser-ui/react/styles.css"; // Optional reference theme.

<Browser
  streamUrl={session.streamUrl}
  viewportSize={{ width: 1440, height: 900 }}
  operating={session.agentActive}
  operatingLabel={session.currentTask}
  onTakeControl={session.takeControl}
  showPictureInPicture
  showFullscreen
/>
```

Components are unstyled by default and expose stable `bui-` classes and data
attributes. Import the optional stylesheet above as a reference theme, or style
the primitives with the host application's design system.

The host owns the browser process, stream URL, navigation, and workflow state.
`Browser` owns the interactive viewport, visual agent activity, and display
modes for inline, picture-in-picture, and fullscreen use.

Pointer, keyboard, paste, and wheel input are forwarded by the live viewport.
Wheel capture works inside nested application scrollers and fullscreen layouts,
including WebKit's legacy trackpad events, so hosts should not create a
second WebSocket or install their own browser-input boundary.

Pass `fullscreenTarget` when fullscreen should fill an application panel rather
than the complete viewport. Browser UI tracks the element's bounds, radius, and
resizing while the same mounted browser frame moves above application chrome:

```tsx
const [panel, setPanel] = useState<HTMLDivElement | null>(null);

<div ref={setPanel}>
  <Browser
    streamUrl={session.streamUrl}
    fullscreenTarget={panel}
    showFullscreen
  />
</div>
```

## Host controls

Browser UI owns the control rail's placement, display-mode transitions, and
visual treatment. Applications can compose their own actions into that rail
without moving workflow behavior into the package:

```tsx
import {
  Browser,
  BrowserDisplayTrigger,
  BrowserFullscreenTrigger,
} from "@browser-ui/react";

<Browser
  streamUrl={session.streamUrl}
  displayControls={
    <>
      <BrowserDisplayTrigger
        aria-label="Open in primary browser"
        onClick={session.openExternally}
      >
        <ExternalLinkIcon />
      </BrowserDisplayTrigger>
      <BrowserFullscreenTrigger />
      <BrowserDisplayTrigger
        aria-label="End browser session"
        onClick={session.end}
      >
        <CloseIcon />
      </BrowserDisplayTrigger>
    </>
  }
/>
```

Use `displayControlsClassName` to adjust how a host's controls reveal while
keeping them inside Browser UI's package-owned top-right rail.

## Access and control

Browser UI projects access state without choosing an authentication system.
Map a Nostr public key, cookie session, Better Auth user, or JWT subject to a
`BrowserPrincipal`; let the gateway enforce capabilities and an exclusive
control lease.

```tsx
<BrowserAccessRoot
  access={session.access}
  onRequestControl={session.requestControl}
  onReleaseControl={session.releaseControl}
>
  <Browser
    access={session.access}
    streamUrl={session.stream.url}
    protocols={session.stream.protocols}
  />
  <BrowserControlStatus />
  <BrowserControlTrigger />
</BrowserAccessRoot>
```

`Browser` sends input only when the projected viewer owns control. This is a
client-side guard, not authorization: the gateway must reject every input that
does not carry or belong to the current server-issued lease.

## Playback

[`agent-browser` records browser sessions to WebM](https://agent-browser.dev/recording)
with its native recording commands:

```sh
agent-browser record start ./workflow.webm
# Run the workflow.
agent-browser record stop
```

Render that static artifact with `BrowserRecording`. It uses the same frame,
agent activity treatment, picture-in-picture, and fullscreen presentation as a
live session. A recording is intentionally not a substitute for `Browser`: it
does not claim to accept user input after playback has stopped.

```tsx
import { useRef } from "react";
import { BrowserRecording } from "@browser-ui/react";

const recording = useRef<HTMLVideoElement>(null);

<BrowserRecording
  ref={recording}
  src="/workflows/checkout.webm"
  viewportSize={{ width: 1440, height: 900 }}
  playbackRate={1.25}
  showPictureInPicture
  showFullscreen
  videoProps={{ controls: true }}
/>
```

The forwarded `HTMLVideoElement` ref provides normal `play`, `pause`, `seek`,
and `currentTime` control. Use `videoProps` for standard video events, captions,
or controls.

See the [repository](https://github.com/danielsims/browser-ui) for the live demo
and lower-level composition primitives.
