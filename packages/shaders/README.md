# @browser-ui/shaders

Framework-neutral GLSL sources and configuration for Browser UI operating
overlays. The package owns the exact Subtle, Prism, Pulse, and Tide shader
implementations used by `@browser-ui/react`; it has no React or browser runtime
dependency.

```ts
import {
  operatingShaderDirections,
  operatingShaderFragmentSources,
  operatingShaderMeta,
  operatingShaderSpeeds,
  operatingShaderVertexSource,
} from "@browser-ui/shaders";

const variant = "tide";
const fragmentSource = operatingShaderFragmentSources[variant];
const direction = operatingShaderDirections[
  operatingShaderMeta[variant].defaultDirection
].vector;
const cycleSeconds = operatingShaderSpeeds[
  operatingShaderMeta[variant].defaultSpeed
].durationSeconds;
```

Consumers own compilation, uniforms, canvas lifecycle, and rendering. Prism,
Pulse, and Tide accept `u_resolution`, `u_time`, `u_direction`, and `u_speed`.
Subtle intentionally retains its original `u_resolution` and `u_time`
contract.

The package also exports `manifest.json`, `vertex.vert`, and one `.frag` file
per variant. Browser UI's platform release tooling can vendor those raw assets
into Flutter and Swift packages, allowing their native renderers to adapt
only the platform preamble and output binding while keeping the shader math
identical. Application developers install a platform package such as
`@browser-ui/react`, `browser_ui`, or the future Swift package; they do not need
to install this implementation package directly.

Within this repository, `pnpm --filter @browser-ui/shaders sync:flutter`
regenerates Flutter runtime-effect sources from the canonical WebGL source.
The shader test suite verifies that Flutter's current default has not drifted.

For a local Swift package, pass its BrowserUI target source directory explicitly:

```sh
pnpm --filter @browser-ui/shaders sync:swift -- \
  /path/to/BrowserUI/Sources/BrowserUI
```

This generates the Metal shader library and the Swift variant, direction, and
speed configuration without coupling this package to a particular Xcode repo.
