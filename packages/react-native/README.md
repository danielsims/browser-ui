# `@browser-ui/react-native`

React Native and Expo primitives for displaying an agent-browser-compatible JPEG WebSocket stream. The package is intentionally transport-thin: it renders frames, reports lifecycle events, and can forward input. It does not create browser sessions, store credentials, or grant control.

## Install

```sh
pnpm add @browser-ui/core @browser-ui/react-native
```

`react` and `react-native` are peer dependencies. No native module or config plugin is required.

## Inline stream

```tsx
import { AgentBrowserView } from "@browser-ui/react-native";

export function BrowserPreview({ streamUrl }: { streamUrl: string }) {
  return (
    <AgentBrowserView
      streamUrl={streamUrl}
      style={{ aspectRatio: 16 / 10 }}
      onStatusChange={(status, error) => {
        console.log(status, error?.message);
      }}
      onUrlChange={(url) => console.log("remote page", url)}
    />
  );
}
```

The view uses `Image` with `resizeMode="contain"`. Touches in letterboxed space are ignored rather than being clamped onto the remote page. Input is off by default.

Set `interactive` and pass host-projected access only after your application has
acquired control of the session:

```tsx
<AgentBrowserView
  access={session.access}
  streamUrl={streamUrl}
  interactive
/>
```

Touch taps become mouse clicks. Touch drags become coalesced wheel input. Mouse and trackpad pointer events are forwarded as mouse input on platforms that expose React Native pointer events.

## Stream controller

Use the hook when the host needs to own the connection or render custom chrome:

```tsx
const stream = useAgentBrowserStream({
  streamUrl,
  protocols: ["browser-stream", shortLivedTicket],
  reconnect: { maxAttempts: 6 },
});

stream.send({
  type: "input_mouse",
  eventType: "mouseMoved",
  x: 240,
  y: 180,
  button: "none",
  clickCount: 0,
  modifiers: 0,
});
```

Only the newest frame received in a native render interval is committed. Reconnects use bounded exponential backoff, and the retry budget resets only after a stable connection. The socket and pending reconnects are closed while the app is in the background. Call `reconnect()` to explicitly reset an exhausted retry budget.

## Browser sheet

`BrowserSheet` is a host-controlled `Modal`. It uses React Native core `Animated`, `PanResponder`, `Pressable`, and `SafeAreaView`; there is no sheet dependency.

```tsx
<BrowserSheet
  visible={browserOpen}
  onRequestClose={() => setBrowserOpen(false)}
  title="Research browser"
  displayUrl={pageUrl ?? "Connecting"}
  status={status}
>
  <AgentBrowserView
    streamUrl={browserOpen ? streamUrl : null}
    interactive={hasControlLease}
    onStatusChange={setStatus}
    onUrlChange={setPageUrl}
    style={{ flex: 1 }}
  />
</BrowserSheet>
```

The host owns `visible`; backdrop taps, the close button, Android back, and a downward swipe call `onRequestClose`. `displayUrl` is separate from `streamUrl` so browser chrome never accidentally exposes a gateway ticket.

## Reachable authenticated WSS

A stream URL must be reachable from the device. `localhost`, `127.0.0.1`, and `::1` refer to the phone, simulator, or emulator, not a development server elsewhere on your network. Use a routable gateway with a certificate trusted by the device:

```text
wss://browser-gateway.example.com/v1/streams/session-id
```

Recommended gateway behavior:

- Authenticate the app before creating a browser session.
- Mint a short-lived, audience-bound, single-use stream ticket when a cookie is
  not available.
- Validate the ticket during the WebSocket upgrade, then proxy the agent-browser protocol.
- Expire the stream promptly when the session or user authorization ends.
- Rate-limit upgrades and input independently.

Do not put a durable secret in `EXPO_PUBLIC_BROWSER_STREAM_URL`. Expo public environment variables are embedded in the application bundle. Standard WebSocket clients do not provide a portable custom `Authorization` header API; prefer a secure same-origin cookie or negotiated WebSocket subprotocol. Use a short-lived single-use URL ticket only when deployment constraints require it, and keep it out of logs and relay events.

## Exclusive control leases

`interactive` is a presentation switch, not an authorization boundary. For pair browsing, enforce a lease on the gateway:

- Allow any authorized viewer to receive frames.
- Grant at most one controller a short-TTL lease for a browser session.
- Accept input only from the socket that owns the current lease.
- Renew with heartbeats and revoke on disconnect, background timeout, user action, or agent takeover.
- Surface lease ownership in the host app before setting `interactive`.

This prevents two clients, or a human and agent, from issuing conflicting input. Hiding controls in React Native does not.

## Expo demo

The workspace demo reads `EXPO_PUBLIC_BROWSER_STREAM_URL`:

```sh
EXPO_PUBLIC_BROWSER_STREAM_URL='wss://gateway.example.com/stream?ticket=...' \
  pnpm --filter @browser-ui/expo-demo start
```

It rejects missing, non-WSS, and loopback configuration with an explicit unavailable state.
