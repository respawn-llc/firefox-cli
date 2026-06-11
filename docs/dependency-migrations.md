# Dependency Migrations

This page records major dependency migration plans required by the dependency-upgrade policy in `docs/development.md`.

## 2026-06-11 Development Tooling

Scope:

- `eslint` 10 and `@eslint/js` 10.
- `@types/node` 25.
- `typescript` 6.
- `vite` 8.

Release-age evidence as of 2026-06-11:

- `eslint` 10.0.0 was published on 2026-02-06; installed `eslint` 10.4.1 was published on 2026-05-29.
- `@eslint/js` 10.0.1 was published on 2026-02-06.
- `@types/node` 25.0.0 was published on 2025-12-10; installed `@types/node` 25.9.1 was published on 2026-05-19.
- Installed `typescript` 6.0.3 was published on 2026-04-16.
- `vite` 8.0.0 was published on 2026-03-12; installed `vite` 8.0.16 was published on 2026-06-01.

Migration plan:

- Keep the existing ESLint flat config and attach caught errors as `cause` where ESLint 10 reports `preserve-caught-error`.
- Keep TypeScript path aliases and set `ignoreDeprecations` for the TypeScript 6 `baseUrl` deprecation until path aliasing is redesigned.
- Normalize Marionette socket chunks before `Buffer.concat` for the Node 25 type surface.
- Remove explicit `manualChunks: undefined` from the Vite extension build output, preserving Rollup's default chunking behavior.
- Update the Biome schema URL to match the installed Biome CLI.
- Use a Bun override for `shell-quote` 1.8.4 because latest `web-ext` pins `fx-runner` 1.4.0, which pins vulnerable `shell-quote` 1.7.3.

Verification:

- `bun run deps:check`
- `bun run check`
- `bun run release:check:local`

Rollback scope:

- Revert `package.json`, `bun.lock`, and the TypeScript, ESLint, Biome, Vite, and Marionette compatibility edits in the same change.
