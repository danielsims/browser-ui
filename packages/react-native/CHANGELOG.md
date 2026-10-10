# @browser-ui/react-native

## 0.3.0

### Minor Changes

- Add on-device WebView browsing to the React Native package.

  - `WebViewBrowser` component and `WebViewBrowserDriver` (`navigate`, `snapshot`, `evaluate`, `click(ref)`, `type(ref, text)`, `wait`) backed by `react-native-webview`, advertising capabilities through `createBrowserDriverDescriptor`.
  - Shadow-DOM-aware semantic snapshots and fingerprint-based element re-resolution, so clicks survive re-renders and virtualised lists.
  - Operating overlay, action pill and agent cursor injected into the page, so they paint above the `WKWebView` on iOS by construction and survive navigation. The real `@browser-ui/shaders` GLSL runs on an in-page WebGL canvas (no `expo-gl` needed), and the pill renders even if the shader fails. `OperatingOverlay` and `AgentCursor` are exported for non-WebView surfaces.
  - `react-native-webview` and `expo-gl` are optional peer dependencies; `@browser-ui/shaders` is now a dependency.

### Patch Changes

- Updated dependencies [a392728]
- Updated dependencies [763879c]
- Updated dependencies [4dfe85a]
  - @browser-ui/core@0.3.0
  - @browser-ui/shaders@0.3.0
