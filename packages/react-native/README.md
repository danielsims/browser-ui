# `@browser-ui/react-native`

React Native and Expo primitives for displaying an agent-browser-compatible JPEG WebSocket stream. The package is intentionally transport-thin: it renders frames, reports lifecycle events, and can forward input. It does not create browser sessions, store credentials, or grant control.

## Install

```sh
pnpm add @browser-ui/core @browser-ui/react-native
```

`react` and `react-native` are peer dependencies. No native module or config plugin is required.

The on-device WebView driver additionally needs `react-native-webview`:

```sh
pnpm add react-native-webview
```

It is declared as an optional peer dependency, so stream-only consumers do not have to install it.

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
<AgentBrowserView access={session.access} streamUrl={streamUrl} interactive />
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

## On-device WebView

`WebViewBrowser` renders a real `react-native-webview` — not a stream — so video,
carousels, and human touch stay live, and exposes a driver over the same
injected-script bridge the other platforms use. Refs from `snapshot()` map to a
stable `data-browser-ui-ref` attribute, so agent actions and human taps act on
the same elements.

```tsx
import { useRef } from "react";

import type { WebViewBrowserHandle } from "@browser-ui/react-native";
import { WebViewBrowser } from "@browser-ui/react-native";

export function ShopBrowser() {
  const browser = useRef<WebViewBrowserHandle>(null);

  const shop = async () => {
    const driver = browser.current?.driver;
    if (!driver) return;
    await driver.navigate("https://www.woolworths.com.au/");
    const page = await driver.snapshot();
    const search = page.elements.find((el) => el.role === "searchbox");
    if (search) {
      await driver.type(search.ref, "bananas");
      await driver.click(search.ref);
    }
  };

  return (
    <WebViewBrowser
      ref={browser}
      url="https://www.woolworths.com.au/"
      onUrlChange={(url) => console.log("page", url)}
      style={{ flex: 1 }}
      driverOptions={{
        allowsUrl: (url) => !/checkout|payment/i.test(url),
        allowsElement: (el) => !/checkout|place order/i.test(el.name),
      }}
    />
  );
}
```

`WebViewBrowser` props: `url`, `onReady`, `onUrlChange`, `onTitleChange`,
`onStatusChange`, `operating`, `operatingLabel`, `operatingShader`, `agentCursor`,
`onActivityChange`, `driverOptions`, `pointerEvents`, `userAgent`, `style`, and
`children`. Descendants can call `useWebViewBrowser()` for the same driver. The
host owns policy through `driverOptions.allowsUrl` and `driverOptions.allowsElement`.

`WebViewBrowserDriver` methods:

| method            | behavior                                                            |
| :---------------- | :------------------------------------------------------------------ |
| `navigate(url)`   | Navigates the WebView and waits for the document.                   |
| `snapshot()`      | Returns `{ url, title, text, elements }` and tags refs.             |
| `evaluate(js)`    | Evaluates `js` in the page and returns its value.                   |
| `click(ref)`      | Activates a snapshot ref and returns a `WebViewBrowserClickResult`. |
| `type(ref, text)` | Focuses the element and sets its value with input/change events.    |
| `wait(ms)`        | Resolves after `ms`.                                                |

The driver advertises only what it does: `navigation`, `semantic-snapshot`,
`element-click`, `text-input`, `script-evaluation`, and `wait`, with kind
`webkit`.

### Clicking

A bare `HTMLElement.click()` is often ignored on mobile WebKit, so `click()`
scrolls the ref into view, rejects unreachable targets, and dispatches a
realistic `pointerdown → mousedown → touchstart → pointerup → mouseup →
touchend → click` sequence at the element's centre (via `elementFromPoint`).
It then compares a page signature to confirm the activation had an effect.

Snapshot traversal and tagging pierce open shadow roots, and every element
also carries a locator `fingerprint` (`role`, `name`, `tag`, `href`, `text`,
`context`, `index` among same role+name matches). If the tagged node has been
replaced — a virtualised list re-rendered, a framework swapped the DOM — `click`
re-finds the live node by matching that fingerprint against the composed DOM
before ever reporting `ref-not-found`. When resolution does fail, the result's
`message` carries diagnostics: whether the ref attribute still exists anywhere,
the fingerprint tried, role/name candidate counts before and after a scroll, and
a short page-text excerpt.

Rather than throw, `click()` resolves with a precise status:

```ts
const result = await driver.click(ref);
if (result.status !== "clicked") {
  console.log(result.status, result.element, result.message);
}
```

`clicked` means the page reacted; `dispatched-but-unconfirmed` means the
sequence was sent but nothing changed, so verify the outcome yourself. The
unreachable statuses — `ref-not-found`, `element-disabled`, `not-visible`,
`covered` — carry the resolved `{ ref, role, name, rect, excerpt }` and the
events actually sent in `sequence`.

Pass `userAgent` to `<WebViewBrowser>` only when the native agent serves a
materially different DOM; it is off by default.

### Operating overlay and agent cursor

When `operating` is true the view paints the canonical Browser UI operating
shader over the page plus the `operatingLabel` action pill, and shows the agent
cursor, matching the web package's visual language.

A native `WKWebView` composes above its React Native siblings on iOS, so an RN
overlay rendered after the WebView can still sit behind the page. The overlay is
therefore injected **into the page**: a `position: fixed`, full-viewport
container at `z-index: 2147483647` runs the real `@browser-ui/shaders` GLSL on a
WebGL canvas, with the pill and cursor as DOM nodes. All of it is
`pointer-events: none`, and an in-page `MutationObserver` plus a fresh injection
after each navigation re-assert it. `expo-gl` is not needed for `WebViewBrowser`;
the shader compiles in the page and logs its result once as
`[browser-ui] shader ok|err …` (to the page console and to the host via
`postMessage`). The pill and cursor render even if the shader fails, so a missing
shader never means nothing is visible.

Pass `operatingShader` (`{ variant, direction, speed }`, mirroring the web prop)
to select the shader; variant defaults are applied when a field is omitted.
`click()` and `type()` resolve the target's centre and
`driver.subscribeActivity(listener)` emits a normalised `WebViewBrowserCursor`
(`x`/`y` in `0..1`). `WebViewBrowser` subscribes for you and paints the in-page
cursor; pass `agentCursor` to drive it yourself, or `onActivityChange` to observe
the driver's actions. This is visualisation only — the driver never synthesises
input, so it still does not advertise `pointer-input`.

```tsx
<WebViewBrowser
  ref={browser}
  operating={phase === "shopping"}
  operatingLabel="Finding potatoes"
  operatingShader={{
    variant: "tide",
    direction: "top-left-to-bottom-right",
    speed: "fast",
  }}
  url="https://www.woolworths.com.au/"
/>
```

For surfaces that are not a `WebView` — for example the JPEG stream rendered by
`AgentBrowserView` — `OperatingOverlay` and `AgentCursor` remain exported native
primitives. They use React Native `Animated`, and `OperatingOverlay` runs the
same GLSL on an `expo-gl` surface when `expo-gl` is available, falling back to an
animated green/pink wash otherwise. `expo-gl` is an optional peer dependency, so
stream-only consumers can omit it and keep the `Animated` fallback.

## Expo demo

The workspace demo reads `EXPO_PUBLIC_BROWSER_STREAM_URL`:

```sh
EXPO_PUBLIC_BROWSER_STREAM_URL='wss://gateway.example.com/stream?ticket=...' \
  pnpm --filter @browser-ui/expo-demo start
```

It rejects missing, non-WSS, and loopback configuration with an explicit unavailable state.
