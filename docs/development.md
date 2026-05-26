## Development Prerequisites

Use the root scripts in `package.json`; CI must call the same scripts.

Required local tools:

- Bun matching the `packageManager` field in `package.json`.
- Node matching the `engines` field in `package.json`.
- Firefox for extension loading and later E2E tests.

Safety rules:

- Native manifest tests must use temporary paths by default.
- Do not write to real Firefox native-messaging manifest locations unless a setup command explicitly requests it.
- Do not use real user Firefox profiles in automated tests; use disposable profiles.

Useful Phase 0 commands:

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run extension:build`
- `bun run package:check`
