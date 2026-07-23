# @browser-ui/react

A composable, transport-agnostic browser surface for React. It is designed for
live [`agent-browser`](https://github.com/vercel-labs/agent-browser) sessions,
while keeping browser transport and workflow ownership in the host application.

## Install

```sh
npm install @browser-ui/react
```

## Usage

```tsx
import { Browser } from "@browser-ui/react";

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

The host owns the browser process, stream URL, navigation, and workflow state.
`Browser` owns the interactive viewport, visual agent activity, and display
modes for inline, picture-in-picture, and fullscreen use.

See the [repository](https://github.com/danielsims/browser-ui) for the live demo
and lower-level composition primitives.
