## Development

Use the root scripts in `package.json`. CI calls the same checks.

Required local tools:

- Bun matching the `packageManager` field in `package.json`.
- Node matching the `engines` field in `package.json`.
- Firefox for extension loading and manual browser QA.

Common commands:

- `bun install --frozen-lockfile`
- `bun run deps:check`
- `bun run check`
- `bun run extension:build`
- `bun run package:check`
- `bun run release:check`

Dependency upgrades:

- `bun run deps:check` runs `bun audit` and an aged `bun outdated` report.
- Patch and minor upgrades use a 7-day minimum release age.
- Major upgrades use a 30-day minimum release age and require a migration plan.
- After changing dependency manifests or lockfiles, run `bun run check` and `bun run release:check`. Use `bun run release:check:local` for unsigned local dry runs.

Use the [manual command QA checklist](all-commands-qa.md) for browser behavior that crosses the CLI, native host, and extension.

Safety rules:

- Native manifest tests use temporary paths by default.
- Do not write to real Firefox native-messaging manifest locations unless a setup command explicitly requests it.
- Do not kill or restart a real user Firefox process during development or QA.

Release signing:

- `bun run extension:sign` signs `dist/extension` with `web-ext sign`.
- Set `WEB_EXT_JWT_ISSUER` to the Mozilla Add-ons JWT issuer and `WEB_EXT_JWT_SECRET` to the corresponding JWT secret.
- `bun run release:check:signed` requires a signed `dist/extension-artifacts/firefox-cli-<version>.xpi` artifact and matching provenance.

Npm publishing:

- `bun run npm:publish:dry-run` cross-compiles all supported platform binaries, assembles `dist/npm`, verifies the npm package layout, and runs `npm publish --dry-run` for every package.
- `bun run npm:publish:local` runs the same local cross-compiled package flow and publishes `firefox-cli` to npm.
- `bun run npm:publish:ci` is the release workflow entrypoint. It requires the signed XPI artifact under `dist/extension-artifacts`, verifies the signed release package, and publishes through npm trusted publishing.

The published CLI package depends on platform-specific native packages through `optionalDependencies`. npm installs only the package that matches the user's `os` and `cpu`.

Configure npm trusted publishing for `firefox-cli` and each `@respawn-app/firefox-cli-native-*` package with this GitHub repository, workflow `release.yml`, and the `npm` environment. The workflow grants `id-token: write` only to the npm publish job.
