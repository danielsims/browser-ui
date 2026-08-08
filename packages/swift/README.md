# Browser UI for Swift

The `BrowserUI` Swift product mirrors Browser UI's transport-neutral activity,
cursor, chrome, geometry, and operating-overlay primitives for SwiftUI hosts.
Add the browser-ui repository as a Swift Package dependency and import it with:

```swift
import BrowserUI
```

The operating shaders are generated from `@browser-ui/shaders`. Run
`pnpm sync:shaders` at the repository root after changing shared shader source
or defaults; do not edit the generated Metal or Swift configuration directly.
