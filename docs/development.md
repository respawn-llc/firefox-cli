## Development

Use the root scripts in `package.json`; CI calls the same checks.

Required local tools:

- Bun matching the `packageManager` field in `package.json`.
- Node matching the `engines` field in `package.json`.
- Firefox for extension loading and disposable browser E2E.

Common commands:

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run test:e2e`
- `bun run extension:build`
- `bun run package:check`
- `bun run release:check`

`bun run test:e2e` builds the package and runs the native-host smoke test. It launches disposable Firefox only when `FIREFOX_CLI_E2E_DISPOSABLE=1` is set.

Safety rules:

- Native manifest tests use temporary paths by default.
- Do not write to real Firefox native-messaging manifest locations unless a setup command explicitly requests it.
- Automated tests use disposable Firefox profiles, not real user profiles.
- Do not kill or restart a real user Firefox process during development or QA.

Release signing:

- `bun run extension:sign` signs `dist/extension` with `web-ext sign`.
- Set `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET`, or `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`.
- `bun run release:check:signed` requires `dist/package/extension/firefox-cli.xpi` in the assembled package.
