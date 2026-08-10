# Browser UI for Swift

The `BrowserUI` Swift product mirrors Browser UI's transport-neutral activity,
cursor, chrome, geometry, and operating-overlay primitives for SwiftUI hosts.
`BrowserUIWebKit` adds the on-device browser driver for iOS. Add the repository
as a Swift Package dependency and import the products you need:

```swift
import BrowserUI
import BrowserUIWebKit
```

```swift
let browser = WebKitBrowserDriver(configuration: .init(
    dataStore: .persistent,
    desktopViewportSize: CGSize(width: 1440, height: 900)))

browser.begin(scope: conversationID)
try await browser.navigate("https://example.com")
let page = try await browser.snapshot()
```

The driver uses Safari's WebKit engine on the device. It does not bundle
Chromium, launch `agent-browser`, or require a companion computer. Its
`descriptor` lists only the native actions it supports; remote
`agent-browser` sessions remain a separate driver.

The operating shaders are generated from `@browser-ui/shaders`. Run
`pnpm sync:shaders` at the repository root after changing shared shader source
or defaults; do not edit the generated Metal or Swift configuration directly.

`BrowserOperatingOverlay` accepts `subtle`, `prism`, `pulse`, or `tide`, all
eight shared directions, and the shared `slow` and `fast` timing presets:

```swift
BrowserOperatingOverlay(
    label: "Selecting memory",
    variant: .tide,
    direction: .leftToRight,
    speed: .fast)
```

## Install and release

Swift packages are distributed directly from a Git repository through Swift
Package Manager; there is no required npm-style registry. In Xcode, choose
**File → Add Package Dependencies** and enter:

```text
https://github.com/danielsims/browser-ui
```

Or add it to another package:

```swift
dependencies: [
    .package(
        url: "https://github.com/danielsims/browser-ui.git",
        from: "0.3.0"),
],
targets: [
    .target(
        name: "App",
        dependencies: [
            .product(name: "BrowserUI", package: "browser-ui"),
            .product(name: "BrowserUIWebKit", package: "browser-ui"),
        ]),
]
```

Publishing is a signed semantic-version Git tag such as `0.3.0`. Xcode and
SwiftPM resolve that tag directly. A GitHub Release can provide notes, and the
[Swift Package Index](https://swiftpackageindex.com) can make the package more
discoverable, but neither is required for installation.

## Session lifecycle

Presentation and browser lifetime are separate. Dismissing fullscreen returns
to the preview viewport; it must not end the underlying browser. Use the
package-owned terminal control and persist its portable receipt:

```swift
BrowserEndSessionButton {
    do {
        let request = try BrowserSessionEndRequest(
            sessionId: session.id,
            clientInstanceId: device.id)
        let receipt = try await api.endBrowserSession(request)
        transcript.append(receipt)
    } catch {
        present(error)
    }
}
```

Use `.preview` for a stable desktop browser canvas embedded in chat and
`.takeover` while the same browser is presented at the phone's live bounds.
Both modes, every end reason, requests, and receipts are checked against the
same fixture used by the React/core and Flutter test suites.
