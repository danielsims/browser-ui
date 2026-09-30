# Browser UI

React, React Native, Flutter, and Swift components for agent-operated browsers.

Browser UI renders the stream and forwards user input. Your application owns
the browser process, workflow, authentication, authorization, and session
lifecycle.

## Install

For React:

```sh
pnpm add @browser-ui/react
```

For React Native or Expo:

```sh
pnpm add @browser-ui/react-native
```

For Flutter:

```sh
flutter pub add browser_ui
```

## Quick start

Enable streaming in `agent-browser` and pass the resulting WebSocket URL to the
component:

```sh
agent-browser stream enable
agent-browser stream status
```

```tsx
import { Browser } from "@browser-ui/react";

import "@browser-ui/react/styles.css";

<Browser
  streamUrl={session.streamUrl}
  viewportSize={{ width: 1440, height: 900 }}
  interactive={session.hasControl}
  operating={session.agentActive}
  operatingLabel={session.currentTask}
  onEndSession={() => session.end()}
  showPictureInPicture
  showFullscreen
/>;
```

`Browser` is view-only by default. Set `interactive` only after the host has
granted control. Client-side state is not authorization; the stream server must
validate every input event.

See the [live demo](https://browser-ui.danielsi.ms).

## Packages

| Package                                                                              | Platform               | Purpose                                                                        |
| ------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------ |
| [`@browser-ui/react`](https://www.npmjs.com/package/@browser-ui/react)               | React                  | Browser chrome, live streams, recordings, PiP, and fullscreen                  |
| [`@browser-ui/react-native`](https://www.npmjs.com/package/@browser-ui/react-native) | React Native / Expo    | Native stream viewer and browser sheet                                         |
| [`browser_ui`](https://pub.dev/packages/browser_ui)                                  | Flutter                | Flutter stream controller, viewer, and browser sheet                           |
| `BrowserUI`                                                                          | Swift / SwiftUI        | Shared lifecycle, viewport, cursor, chrome, and shader primitives              |
| `BrowserUIWebKit`                                                                    | Swift / SwiftUI        | An on-device WebKit browser that an agent can operate without a remote browser |
| [`@browser-ui/core`](https://www.npmjs.com/package/@browser-ui/core)                 | Any JavaScript runtime | Protocol, session, geometry, recording, and access contracts                   |
| [`@browser-ui/gateway`](https://www.npmjs.com/package/@browser-ui/gateway)           | Node.js                | Optional authenticated relay and `agent-browser` source connector              |

Each package has its own API documentation and examples. Applications only
need the package for their platform; the gateway is optional.

Closing a viewer and ending a session are deliberately different actions.
Closing only changes presentation. Ending is terminal, releases browser
resources, returns a portable receipt, and can be rendered in the transcript.
React, Flutter, and Swift validate this contract against the same fixture.

## Browser drivers

Browser UI keeps the browser engine separate from the interface around it:

- `AgentBrowser` renders a live stream from the upstream
  [`agent-browser`](https://github.com/vercel-labs/agent-browser) runtime. The
  upstream CLI or MCP server remains responsible for browser automation.
- `WebKitBrowserDriver` runs directly on iPhone and exposes semantic page
  snapshots and browser actions without Chromium, a Mac, or a remote service.

Both publish a versioned capability descriptor, so a host can enable only the
operations its selected driver actually supports. The shared UI and lifecycle
contracts remain the same; engine-specific automation stays in its driver.

## Recordings

`BrowserRecording` renders native WebM recordings from `agent-browser` with the
same browser frame and display modes as a live session.

```tsx
import { BrowserRecording } from "@browser-ui/react";

<BrowserRecording
  src="/workflows/checkout.webm"
  viewportSize={{ width: 1440, height: 900 }}
  showPictureInPicture
  showFullscreen
  videoProps={{ controls: true }}
/>;
```

Recordings are always non-interactive. Use `Browser` for live sessions.

## Remote sessions

The local `agent-browser` stream binds to loopback. Phones, remote viewers, and
shared sessions need a reachable authenticated `wss://` endpoint. The optional
gateway accepts one source, fans frames out to viewers, and forwards input only
from the active server-issued control lease.

Read the [architecture and security model](./docs/architecture.md) before
exposing a stream outside the local machine.

## Development

Requires Node.js 24 and pnpm 10.

```sh
pnpm install
pnpm dev
```

Run the demo against a real local `agent-browser` session:

```sh
pnpm dev:live
```

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the
branch, pull request, testing, and Changesets workflow.

## License

MIT
