# Releasing Browser UI

The four npm packages use independent Changesets versions and compatible
`workspace:^` dependency ranges. Changesets updates and publishes dependants
when their requirements change. The Flutter package is published separately to
pub.dev because Changesets only manages npm packages.

## Initial npm publication

The `0.2.0` release introduces three package names alongside the existing
`@browser-ui/react` package. Authenticate as an owner of the `@browser-ui`
scope, then run the release command from the repository root:

```sh
npm whoami
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
pnpm release
```

`changeset publish` discovers unpublished workspace versions and publishes them
in dependency order. If they must be published individually, use this order:

1. `@browser-ui/core`
2. `@browser-ui/gateway`
3. `@browser-ui/react-native`
4. `@browser-ui/react`

`core` is the only strict ordering constraint. The remaining packages can be
published after it exists.

## Future npm releases

Add a changeset with the code change:

```sh
pnpm changeset
```

Pushing to `main` makes the Changesets GitHub Action maintain a release pull
request. Merging that pull request publishes changed packages and creates the
matching git tags. Add an npm automation token as the repository secret
`NPM_TOKEN` before relying on the workflow.

## Flutter publication

The Dart package lives at `packages/flutter` and is released independently:

```sh
cd packages/flutter
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
dart pub publish --dry-run
dart pub publish
```

The first publish claims the currently available `browser_ui` package name for
the authenticated pub.dev account. Subsequent releases should keep its public
API version aligned with the npm release train manually.
