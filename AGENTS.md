## Context

`firefox-cli` is a Bun/TypeScript workspace for controlling a user's normal Firefox session from a terminal. It exposes an npm-distributed CLI named `firefox-cli`, a native messaging host, a Firefox WebExtension, and a shared protocol package.

The CLI must talk to the user's real Firefox session through the extension and native host. Do not base product behavior on launching a separate automation-only browser profile.

## Commands / workflow guidance

Use the root Bun workspace scripts as the source of truth. CI runs the same checks. The workspace is pinned to Bun through `packageManager` in `package.json` and uses `bun.lock` as the only dependency lockfile.

- Run `bun run check` for the root quality gate. It runs format checking, version sync checking, dependency and TypeScript policy gates, Biome, ESLint, source-size checks, typecheck, unit tests, build, extension lint, and package layout checks.
- Run `bun run typecheck` after cross-package type or protocol changes when a full check is not needed yet.
- Run `bun run test` for unit and policy tests.
- Run `bun run extension:build` to create the loadable development extension in `dist/extension`.
- Run `bun run package:check` after packaging or install-layout changes.
- Run `bun run release:check`, `bun run release:check:local`, or `bun run release:check:signed` for release-package verification depending on whether a signed XPI is required.
- Run `bun run deps:check` when dependency manifests or lockfiles change.

Package-local scripts exist for focused `format`, `lint`, `test`, and `typecheck`, but include a root typecheck or stronger root check before finishing work that touches package boundaries.

## Testing instructions

Write or update tests with behavior changes in protocol schemas, CLI command parsing/output, native-host transport/pairing, extension command handlers, browser API adapters, and packaging/release scripts.

Test typed request/response contracts and stable error mapping rather than duplicating implementation details. Keep browser-facing behavior testable without a live Firefox profile by isolating WebExtension APIs behind small adapters and mocks.

Keep CLI-to-extension request contracts, native messaging, local IPC, pairing state, install layout, binary output paths, and packaging behavior covered by focused automated tests. Use manual Firefox QA for end-to-end browser behavior.

Use Vitest for workspace TypeScript tests and Node's built-in test runner for policy tests under `scripts/check-*.test.mjs`. Keep security-sensitive native-host behavior covered by targeted tests.

## Project layout & module map

Use package boundaries that assign ownership to the CLI, native host, extension, and shared protocol:

- `packages/cli`: CLI entrypoint, argument parsing, terminal output, setup/doctor UX, local IPC client, and packaging entrypoint.
- `packages/extension`: Firefox MV3 WebExtension source, manifest, popup, browser API adapters, background/content scripts, permissions, and extension packaging assets.
- `packages/native-host`: Firefox native messaging stdio handling, per-user local IPC, IPC auth, native-host manifest registration primitives, pairing state, platform binary resolution, file writes for binary outputs, and extension connection brokering.
- `packages/protocol`: command names, request/response schemas, runtime validation, protocol versioning, and compatibility helpers shared by the CLI and extension.
- `packages/test-support`: fixtures, fake transports, browser API mocks, and cross-package test helpers.
- `scripts`: repository automation for package assembly, extension bundling/signing, native-messaging manifest checks, release verification, and dependency policy.
- `docs`: user-facing setup, command reference, development, architecture, and capability notes.

Import workspace packages through their public package exports. Do not deep-import another package's `src` internals.

## Dev environment tips

- Keep developer-specific Firefox profile paths, generated extension IDs, native-host locations, pair tokens, approval state, and local install state out of tracked files.
- Do not write tests that use a real Firefox profile or real user native-messaging manifest locations by default. Use temporary paths unless a setup command explicitly requests a real install mutation.
- Do not kill, restart, or mutate a real user Firefox process during development or QA automation.
- Do not manually copy generated artifacts between packages. Build, package, native-host registration, and doctor flows must be executable from root scripts or `firefox-cli setup`/`firefox-cli doctor`.
- Update `dependency-policy.json` when adding or removing direct dependencies. The policy gate rejects unreviewed direct dependencies and non-Bun lockfiles.
- Follow the dependency-upgrade policy from `docs/development.md`. Patch and minor upgrades need a 7-day minimum release age. Major upgrades need a 30-day minimum release age and a migration plan.
- Keep all package versions aligned with the root version. `bun run version:check` enforces this.

Native-host stdout is reserved for Firefox native messaging frames. Human-readable diagnostics belong in CLI output, stderr, logs, or structured protocol diagnostics.

## Architecture notes

These ownership boundaries assign responsibilities:

- The CLI owns command parsing, help text, terminal UX, output formatting, process exit codes, local configuration, and initiating local IPC requests.
- The native host owns Firefox native messaging, CLI-to-host IPC, IPC authentication, pairing state, extension identity checks, request forwarding, native-host manifest generation, and output-file writes.
- The extension owns Firefox permissions, browser API access, popup approval/reset UX, target resolution, private-window guards, content-script orchestration, command routing, and browser API error translation.
- Content scripts own page-local actions and page analysis: snapshots, element refs, DOM events, queries, waits, eval, and frame diagnostics.
- The protocol package owns command IDs, schemas, envelope codecs/factories, version negotiation, runtime validation, stable errors, capability metadata, and compatibility rules.

Validate every message crossing process, native-messaging, local IPC, browser, extension, or content-script boundaries at runtime. TypeScript types alone are not sufficient for boundary data.

Use Firefox native messaging as the extension-to-native transport and per-user local IPC as the CLI-to-native transport. Keep native messaging and local IPC details behind interfaces so command handlers stay transport-agnostic.

Target resolution belongs in the extension. Resolve default commands against Firefox's active tab/window at command time. Use the indexes printed by `tab`/`window`, and resolve `id:<number>` as Firefox IDs.

Use broad host access for the full-control model after first-use approval, but add specialized Firefox permissions only when their command group is implemented. Document non-obvious permissions next to the manifest or permission declaration.

Use WebExtension/content-script actions for interaction behavior. Do not add OS-level input emulation unless concrete target-site testing shows content-script actions cannot support required behavior.

Return structured protocol errors from the extension and map them to concise CLI output at the CLI edge. Include diagnostic details in logs, JSON output, or protocol diagnostics. Normal text output excludes browser internals.

Unsupported command families must fail with `UNSUPPORTED_CAPABILITY` and appear in capability metadata. Do not silently map Chrome/CDP-only behavior to unrelated Firefox fallbacks.

## Code style

Use TypeScript, ESM, strict typechecking, and Bun workspaces for first-party code. Keep protocol types and validators colocated in `packages/protocol`.

- Biome formats code with 2-space indentation, double quotes, semicolons, trailing commas, and 160-column line width.
- ESLint enforces strict type-aware TypeScript rules, no `any`, no unsafe operations, no floating promises, exhaustive switches, no mutable exports, max complexity 12, max depth 4, max 4 parameters, and max 350 nonblank/noncomment lines per file.
- Use `import type` consistently. Do not use type assertions. Model unknown data with schemas, narrowing, and typed helpers.
- Do not use `console` outside automation scripts under `scripts`.
- Do not use Node or Bun built-ins in extension runtime source. Keep Node/Bun APIs in CLI, native-host, scripts, tests, or build tooling.
- Do not access global `browser` or `chrome` APIs outside `packages/extension/src` boundary adapters.

Prefer small handlers with explicit dependencies for transport, browser adapters, filesystem access, clocks/timers, and terminal output. This keeps CLI and extension behavior testable without a real Firefox session.

Avoid stringly typed command names and ad-hoc payloads. Add protocol messages through `packages/protocol` and update CLI senders, native-host forwarding, extension receivers, capability metadata, and tests in the same change.

Do not add persistent automation profiles, saved browser sessions, auth vaults, cookie/storage snapshot stores, domain allowlists, or per-action confirmation policies. After first-use approval/pairing, commands have full control by default.

Do not add top-level `close`, `quit`, or `exit` commands for the real browser session. Use explicit `tab close` and `window close` commands.

## Common workflows

When adding a CLI command, update the CLI parser, shared protocol schema, extension handler, tests for both sides, and command help together.

When adding browser capability, start at the extension permission/API boundary, expose the smallest protocol operation needed by the CLI, then design the CLI flags around user intent.

When changing native-host setup or packaging, update manifest generation, `doctor`/`setup` behavior, package layout checks, release checks, and docs that describe installed artifacts.

When changing extension permissions, update protocol capability metadata, manifest generation or `manifest.json`, architecture policy tests, extension build/lint checks, and user-facing setup/security docs when behavior changes.

When changing dependency manifests, update `dependency-policy.json`, keep `bun.lock` as the only lockfile, run `bun run deps:check`, and include root verification.

## Known pitfalls / footguns

Firefox WebExtensions are not ordinary Node programs. Browser APIs, permissions, background lifecycle, and message passing must stay behind extension-side adapters.

The CLI cannot inspect or mutate the active Firefox session without extension cooperation. Bypassing the extension risks controlling the wrong browser/profile or depending on unsupported Firefox internals.

Users can have mismatched CLI and extension versions. Include explicit protocol version checks before adding behavior that assumes both sides upgraded together.

Firefox WebExtensions lack Chrome CDP/debugger parity. Implement browser control through Firefox extension APIs and content scripts, and return explicit unsupported-capability errors for Chrome-only commands.

Private windows are readable for listings and diagnostics, but mutating commands must be rejected unless the command is explicitly designed and permitted for private browsing.

Snapshots and actionable element refs target the main frame. Iframe data is diagnostic/read-only unless iframe-targeted command support is added across protocol, extension, content scripts, tests, and docs.

Refs are scoped to a snapshot generation and can become stale after navigation, reload, document replacement, TTL expiry, or memory pressure. Return `REF_NOT_FOUND` with actionable guidance when a ref is stale.

Screenshots select the requested tab within its window. Use `--focus` to request window foregrounding. Full-page screenshots are unsupported unless Firefox/WebExtension support is implemented deliberately.

Browser-internal and privileged Firefox pages can block extension scripting. Surface script-injection failures as protocol errors. Do not bypass Firefox restrictions.

Native messaging messages from native app to extension are size-limited. Keep native app-to-extension payloads small and use files or extension-to-native flows for large data where supported.

## PR & git instructions

Use concise imperative commit subjects matching the repository history, such as `Add ...`, `Update ...`, `Fix ...`, `Harden ...`, `Split ...`, `Consolidate ...`, or `Release ...`.

## Maintaining this file

Keep `AGENTS.md` current when changing the project. Add durable, project-specific guidance for future feature work. Remove stale guidance promptly. Do not add temporary notes, changelog entries, rollout history, generic development advice, machine-specific setup, or commands that are not backed by tracked files.
