# Browser UI Architecture

Browser UI is a set of composable presentation and input primitives for remote
browser sessions. It is not a browser runtime, identity provider, session
gateway, or policy engine.

The intended shape is similar to headless UI libraries: applications bring
their own design system and authentication, while Browser UI provides one
hardened implementation of frame rendering, contained input geometry,
connection lifecycle, control-state presentation, and platform conventions.

## System Boundaries

There are four separate responsibilities:

1. The browser host starts and owns the real browser process.
2. The session gateway authenticates viewers, authorizes capabilities, relays
   frames and input, issues control leases, and records audit events.
3. The host application maps its identity and collaboration model into the
   Browser UI contracts.
4. Browser UI renders state and emits user intent.

Keeping these boundaries separate lets the same UI work in Buzz, Slack, Linear,
Raycast, a Vercel dashboard, or a Better Auth application without putting a
Nostr or JWT implementation into a component library.

## Local And Remote Streams

A mobile device can consume the same frame and input protocol as a desktop.
The current agent-browser stream commonly binds to `127.0.0.1`; that address is
only reachable from the machine hosting the process. A phone given
`ws://127.0.0.1:9223` connects to itself.

Local desktop integrations may connect directly to loopback. Collaborative web
and mobile integrations need an authenticated, reachable `wss://` gateway:

```text
browser host <-> authenticated session gateway <-> web/mobile viewers
```

The UI API does not otherwise change. `@browser-ui/react-native` and the Flutter
package are deliberately dumb consumers of a supplied stream URL.

## Threat Model

A browser session on a personal computer is not automatically equivalent to
desktop-wide computer control, but it can still carry substantial authority:

- Existing cookies may provide access to personal or business accounts.
- A controller can submit forms, change permissions, publish, purchase, or
  delete data available to the browser profile.
- File upload controls can expose local files if the browser host permits them.
- Downloads, custom protocol handlers, extensions, and local-network pages can
  cross the browser boundary.
- Channel observers can see private page content, authentication screens, and
  notifications even without control.
- A malicious page can attempt to trick an agent or human controller.

The default browser profile should therefore be isolated from the user's daily
profile. Hosts should disable extensions, local file URLs, arbitrary downloads,
local-network access, and broad domain navigation unless the workflow requires
them. Provider-specific setup sessions should apply domain allowlists.

## Observe Is Not Control

Session visibility and input authorization are independent.

Recommended defaults:

- Channel members may observe a channel-visible session.
- Only the session owner and explicitly selected agents may request control.
- Only one principal holds control at a time.
- Other users require an explicit grant or an owner-approved request.
- Closing a viewer does not terminate the browser session.
- Ending a session is a separate `terminate` capability.

Browser UI uses four gateway-enforced capabilities:

| Capability | Meaning |
| --- | --- |
| `observe` | Receive frames and non-sensitive session metadata. |
| `control` | Request and renew an exclusive input lease. |
| `manage` | Grant, revoke, or preempt another controller. |
| `terminate` | End the underlying browser session. |

Client-side state is never sufficient authorization. A gateway must reject
every input message unless its connection currently owns a valid control lease.

## Control Leases

Control is represented as a short-lived exclusive lease rather than a durable
boolean permission. A lease has an opaque ID, holder, expiry, and renewal state.

The gateway should:

1. Authenticate the requesting principal.
2. Verify current session and channel access.
3. Check the principal's `control` capability.
4. Atomically issue one lease or create a control request.
5. Require the lease on every input message.
6. Renew only while the viewer is active.
7. Expire it after disconnect or a short timeout.
8. Let an authorized owner revoke or preempt it immediately.
9. Write grant, denial, takeover, release, expiry, and sensitive-mode events to
   the host application's audit trail.

The browser host should also reject input that arrives without a gateway-issued
lease. Defense in depth matters when the controlled browser contains real
accounts.

## Sensitive Mode

Channel visibility is inappropriate while entering passwords, passkeys,
recovery codes, payment details, private keys, or generated credentials.

Sessions need a server-authoritative sensitive mode that:

- Restricts frames and control to the owner, or a separately approved audience.
- Sends other observers a placeholder rather than the latest sensitive frame.
- Revokes non-owner control leases before the transition.
- Avoids persisting sensitive frames in recordings, thumbnails, logs, and
  message previews.
- Emits an audit event without including sensitive values.
- Requires an explicit transition back to collaborative visibility.

The browser host can automatically suggest sensitive mode when a password or
payment field receives focus, but workflows must also be able to enter it
explicitly. DOM detection is useful defense, not a complete policy.

## Identity Adapters

Browser UI receives an opaque `BrowserPrincipal` with `id`, `displayName`, and
`kind`. It does not parse credentials.

### Buzz / Nostr

The gateway can authenticate a signed challenge or NIP-98 request, resolve the
public key's current community and channel membership, and project that public
key as the principal ID. Channel membership can grant `observe`; control grants
should remain explicit. Relay messages announce an opaque session ID, never a
local process name, port, or durable bearer token.

### Cookie Sessions / Better Auth

A same-origin gateway can use the existing secure HTTP-only session cookie.
The application resolves the user ID and projects it as the principal ID. The
browser never exposes the cookie to Browser UI.

### JWT / OAuth Access Tokens

The application should exchange its normal credential over HTTPS for a
short-lived, session-scoped stream ticket. Do not place a durable bearer token
in a WebSocket query string. Browser clients can use a secure same-origin
cookie, a short-lived single-use URL ticket, or a negotiated WebSocket
subprotocol according to the gateway's deployment constraints.

## Session Descriptor

Messages and artifacts should contain portable metadata only:

```json
{
  "version": 1,
  "session_id": "opaque-random-id",
  "title": "Configure analytics",
  "viewport": { "width": 1280, "height": 800 },
  "page_url": "https://analytics.google.com/",
  "visibility": "channel"
}
```

They must not contain local ports, process names, profile paths, or long-lived
credentials. An authenticated API resolves `session_id` into a short-lived
viewer connection appropriate for the current principal.

Direct loopback adapters may temporarily carry a local stream URL in memory,
but it is not the cross-platform protocol and should not be persisted to a
relay as the durable session identity.

## Package Responsibilities

`@browser-ui/core` contains agent-browser and remote-session protocol parsing,
binary frame envelopes, connection resolution, coordinate mapping, cursor and
recording types, principals, capabilities, and control-lease projections.

`@browser-ui/react` contains the DOM/WebSocket canvas client, web display modes,
recordings, and headless access primitives with stable data attributes.

`@browser-ui/react-native` contains an Expo-compatible image stream viewer,
native lifecycle handling, touch input, and host-controlled browser sheet.

`@browser-ui/gateway` contains the optional authenticated relay, control-lease
enforcement, and its `agent-browser` source connector and CLI. Those source
internals are a distinct runtime domain without becoming another public package.

`packages/flutter` contains the equivalent Dart protocol, controller, view,
and native bottom sheet. Dart and TypeScript share protocol behavior and test
fixtures rather than pretending one language can import the other's types.

## Integration Contract

A host integration should be able to remain this small:

```ts
const session = await api.browserSessions.open(sessionId);

<BrowserAccessRoot
  access={session.access}
  onRequestControl={() => api.browserSessions.requestControl(sessionId)}
  onReleaseControl={() => api.browserSessions.releaseControl(sessionId)}
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

The API response is already authenticated and scoped. Browser UI does not need
to know whether `api` used Nostr, Better Auth, a JWT, or a native app identity.

## Rollout

The safe rollout order is:

1. Harden local desktop rendering and input behavior.
2. Publish the pure core and platform UI packages.
3. Treat completed recordings as ordinary cross-platform artifacts.
4. Build the authenticated remote session gateway and control leases.
5. Add channel observers in view-only mode.
6. Add explicit control requests and grants.
7. Add sensitive mode before shared authentication/setup workflows.
8. Enable mobile control only after real-device latency, lifecycle, and lease
   expiry tests pass.

This keeps the component generic without moving security decisions into a UI
library, where they would be both unportable and ineffective.
