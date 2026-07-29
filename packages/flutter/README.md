# browser_ui

A native Flutter surface for reachable
[`agent-browser`](https://github.com/vercel-labs/agent-browser) WebSocket
streams. It decodes streamed JPEG frames, renders them with `BoxFit.contain`,
and can forward pointer, touch-scroll, and wheel input over the same socket.
There is no WebView and no browser process in this package.

The package is deliberately dumb transport UI. The host owns session creation,
navigation, browser resizing, agent workflow state, control leases, and session
termination.

## Install

```yaml
dependencies:
  browser_ui:
    path: ../browser-ui/packages/flutter
```

The SDK constraint matches Buzz mobile (`sdk: ^3.11.4`) and the only runtime
dependency beyond Flutter is `web_socket_channel`.

## Use

Create one controller for one stream. Construction does not connect, and
dismissing a sheet does not disconnect or terminate anything:

```dart
final browser = AgentBrowserController(
  streamUri: Uri.parse(session.streamUrl),
  protocols: session.streamProtocols,
);

browser.connect();

try {
  await showBrowserSheet<void>(
    context: context,
    controller: browser,
    title: 'Checkout',
    access: session.access,
    // Access must include the viewer's active server-side control lease.
    interactive: true,
    onDismissed: session.releaseControl,
  );
} finally {
  browser.disconnect();
  browser.dispose();
  // End the remote browser session separately if product behavior requires it.
}
```

For custom composition:

```dart
SizedBox(
  width: 420,
  height: 300,
  child: AgentBrowserView(
    controller: browser,
    interactive: hasControl,
    onStatusChanged: reportTransportStatus,
    onUrlChanged: reportPageUrl,
    onFrame: reportFirstFrame,
    onInputSent: auditLocalInput,
  ),
)
```

`AgentBrowserView` is view-only by default. Input in the letterboxed area is
ignored rather than clamped onto the remote page. Touch taps become mouse
clicks; touch drags and pointer scroll signals become browser wheel input.

The controller exposes transport status, the latest decoded frame, browser
status, page URL, cursor, retry timing, and transport/protocol/frame errors. It
pauses its socket while the application is not resumed, reconnects when the app
returns, and keeps only the newest pending frame while decoding.

## Endpoints

Production remote gateways must use `wss://`. Plain `ws://` is accepted by
default for loopback, private/link-local IPs, `.local` hosts, and single-label
LAN development hosts, including common emulator addresses such as
`10.0.2.2`. A public insecure endpoint is rejected unless
`allowInsecureRemote: true` is explicitly set.

Mobile platform policy still applies. Android cleartext traffic and iOS App
Transport Security can block local `ws://` development URLs. Add narrowly
scoped development exceptions in the host application; do not weaken global
production transport policy.

`localhost` means the phone or emulator, not a browser process running on a
remote server. A remote agent-browser instance needs a reachable authenticated
gateway that proxies its stream. WebSocket subprotocols can be supplied through
`AgentBrowserController.protocols`; otherwise authentication is the gateway's
responsibility.

## Security and control

- Do not expose an unauthenticated agent-browser socket to the internet.
- Use `wss://`, short-lived session credentials, server-side authorization, and
  strict per-session routing for remote gateways.
- Treat URL query credentials as sensitive because URLs are commonly logged.
- `interactive: false` is a UI default, not an authorization boundary.
- Acquire and enforce an exclusive control lease at the gateway before enabling
  input. Reject stale or concurrent input server-side.
- Revoke the lease when the app backgrounds, the sheet closes, or the workflow
  resumes agent control. The host decides whether that also ends the session.
- Bound frame size and session lifetime at the gateway as well as in the client.

The parser ignores additive fields and safely represents unknown message types,
but malformed known messages are dropped. The controller caps encoded frame
length and reconnect delay. These are resilience measures, not substitutes for
a trusted gateway.

## Public API

- `AgentBrowserProtocol` and protocol message models
- `AgentBrowserController`, `AgentBrowserReconnectPolicy`, and connection state
- `ContainedViewportGeometry`
- `AgentBrowserView`
- `BrowserSheet` and `showBrowserSheet`

## Verification

```sh
flutter pub get
flutter analyze
flutter test
```

No lockfile should be committed for this package.
