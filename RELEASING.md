# Releasing Browser UI

The four npm packages use independent Changesets versions and compatible
`workspace:^` dependency ranges. Changesets updates and publishes dependants
when their requirements change. The Flutter package is published separately to
pub.dev because Changesets only manages npm packages.

## npm publication

Authenticate as an owner of the `@browser-ui` scope, then run the release
command from the repository root:

```sh
npm whoami
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm release
```

The release command builds packages serially, then publishes the completed
artifacts without rerunning concurrent package build hooks. If packages must be
published individually, use this order:

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
request. Merging that pull request updates package versions; publication remains
a manual `pnpm release` step. Push the tags created by Changesets after the
release succeeds.

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
