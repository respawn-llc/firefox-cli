## Development

Use the root scripts in `package.json`; CI calls the same checks.

Required local tools:

- Bun matching the `packageManager` field in `package.json`.
- Node matching the `engines` field in `package.json`.
- Firefox for extension loading and disposable browser E2E.

Common commands:

- `bun install --frozen-lockfile`
- `bun run deps:check`
- `bun run check`
- `bun run test:e2e`
- `bun run extension:build`
- `bun run package:check`
- `bun run release:check`

Dependency upgrades:

- `bun run deps:check` runs `bun audit` and an aged `bun outdated` report.
- Patch and minor upgrades use a 7-day minimum release age.
- Major upgrades use a 30-day minimum release age and require a migration plan.
- After changing dependency manifests or lockfiles, run `bun run check` and `bun run release:check`. Use `bun run release:check:local` for unsigned local dry runs.

`bun run test:e2e` builds the package and runs the native-host smoke test. It launches disposable Firefox only when `FIREFOX_CLI_E2E_DISPOSABLE=1` is set.

Safety rules:

- Native manifest tests use temporary paths by default.
- Do not write to real Firefox native-messaging manifest locations unless a setup command explicitly requests it.
- Automated tests use disposable Firefox profiles, not real user profiles.
- Do not kill or restart a real user Firefox process during development or QA.

Release signing:

- `bun run extension:sign` signs `dist/extension` with `web-ext sign`.
- Set `WEB_EXT_JWT_ISSUER` to the Mozilla Add-ons JWT issuer and `WEB_EXT_JWT_SECRET` to the corresponding JWT secret.
- `bun run release:check:signed` requires `dist/package/extension/firefox-cli.xpi` in the assembled package.
