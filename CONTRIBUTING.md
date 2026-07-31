# Contributing to Browser UI

Thanks for contributing.

## Workflow

1. Create a branch from the latest `main`. Use a short descriptive name such
   as `fix/stream-reconnect` or `feat/browser-toolbar`.
2. Keep commits focused and write concise, imperative commit messages.
3. Run the checks relevant to your change.
4. Open a pull request. Changes reach `main` through a passing pull request,
   not a direct push.

Avoid unrelated formatting or generated-file changes in the same pull request.

## Local checks

The JavaScript and TypeScript workspace requires Node.js 24 and pnpm 10:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

For Flutter changes:

```sh
cd packages/flutter
flutter pub get
dart format --output=none --set-exit-if-changed lib test
flutter analyze
flutter test
dart pub publish --dry-run
```

CI runs both suites for every pull request.

## Changesets

Add a Changeset when a pull request changes the published behavior of an npm
package:

```sh
pnpm changeset
```

Choose the affected packages and the appropriate semantic version bump. A
Changeset is normally unnecessary for documentation, tests, CI, or private demo
applications.

After a Changeset reaches `main`, the release workflow maintains a version pull
request. Package publication remains a separate maintainer action described in
[RELEASING.md](./RELEASING.md).
