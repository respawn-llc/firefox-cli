## Context

`firefox-cli` is a Bun/TypeScript project for controlling the user's main Firefox session from a terminal. The product has two runtime surfaces: a Firefox WebExtension with access to browser state, and an npm-distributed CLI named `firefox-cli`.

Keep CLI behavior, native-host transport, extension behavior, and cross-process protocol definitions separate. The CLI must talk to the user's normal Firefox session through the extension; do not base core behavior on launching an automation-only browser profile.

## Commands / Workflow Guidance

Run the root quality gate with `bun run check`. It runs formatting, lint, typecheck, unit tests, build, extension build/lint, and package layout checks through tracked root scripts.

Use `bun run extension:build` for the loadable development extension artifact, `bun run package:check` for npm package layout verification, and `bun run release:check` for Phase-aware release verification.

For package-local changes, keep package-specific checks available, but always include a root typecheck or equivalent cross-package validation so protocol drift is caught across package boundaries.

## Testing Instructions

Write tests for protocol schemas, CLI command behavior, and extension message handlers when adding or changing behavior. Test the typed request/response contract rather than duplicating implementation details.

Keep browser-facing behavior testable without a live Firefox profile. Isolate WebExtension APIs behind small adapters so command handling, validation, and error mapping can run in ordinary TypeScript tests.

Add integration coverage for CLI-to-extension transport, native messaging or broker setup, install layout, and packaging changes. These paths cross process and browser boundaries and are not protected by TypeScript alone.

## Project Layout & Module Map

Use package boundaries that preserve the CLI, native host, extension, and shared protocol:

- `packages/extension`: Firefox WebExtension source, manifest, browser API adapters, background/content scripts, permissions, and extension packaging assets.
- `packages/cli`: CLI entrypoint, argument parsing, terminal output, setup/doctor UX, local IPC client, and packaging entrypoint.
- `packages/native-host`: Firefox native messaging stdio handling, per-user local IPC, native-host manifest registration primitives, pairing state, and extension connection brokering.
- `packages/protocol`: command names, request/response schemas, runtime validation, protocol versioning, and compatibility helpers shared by the CLI and extension.
- `packages/test-support` or `tests`: fixtures, fake transports, browser API mocks, and cross-package integration tests.
- `scripts`: repository automation for packaging, extension bundling, native-messaging manifest generation, and release preparation.

Do not duplicate protocol types or validation in runtime packages. Put shared data shapes and boundary validation in `packages/protocol`.

## Dev Environment Tips

Keep developer-specific Firefox profile paths, generated extension IDs, native host locations, and local install state out of tracked files. Put machine-local values in ignored config or pass them through explicit commands.

Avoid workflows that require manually copying generated files between packages. Packaging and native-host registration flows should be executable from root scripts or `firefox-cli setup`/`firefox-cli doctor`.

## Architecture Notes

Preserve these ownership boundaries:

- The CLI owns command parsing, terminal UX, process exit codes, local configuration, and starting communication.
- The native host owns Firefox native messaging, local IPC, pairing state, and forwarding between CLI invocations and the extension.
- The extension owns Firefox permissions, browser API access, tab/window operations, content-script orchestration, and browser API error translation.
- The protocol package owns message schemas, version checks, runtime validation, and compatibility rules.

Validate every message crossing the CLI-extension boundary at runtime. TypeScript types alone are not sufficient for data crossing process, native-messaging, browser, or extension boundaries.

Use Firefox native messaging as the default transport. Hide native messaging and local IPC details behind interfaces so command handlers stay transport-agnostic.

Use broad host access for the MVP full-control model, but add specialized Firefox permissions only when their command group is implemented. Document each non-obvious permission next to the manifest or permission declaration.

Use WebExtension/content-script actions for the MVP interaction backend. Do not add OS-level input emulation unless target-site testing produces concrete failures that block the product.

Return structured protocol errors from the extension and map them to concise CLI output at the CLI edge. Preserve diagnostic detail in logs or debug output without exposing browser internals in normal command output.

## Code Style

Use TypeScript for first-party packages unless the architecture changes and this file is updated. Keep protocol types and validators colocated.

Prefer small command handlers with explicit dependencies for transport, browser adapters, filesystem access, and terminal output. This keeps CLI and extension behavior testable without a real Firefox session.

Avoid stringly typed command names and ad-hoc payloads. Add protocol messages through `packages/protocol` and update senders, receivers, and tests in the same change.

Do not add persistent automation profiles, saved browser sessions, auth vaults, domain allowlists, or per-action confirmation policies to the MVP. After first-use approval/pairing, commands have full control by default.

Do not add top-level `close`, `quit`, or `exit` commands for the real browser session. Use explicit `tab close` and `window close` commands.

## Common Workflows

When adding a CLI command, update the CLI parser, shared protocol schema, extension handler, tests for both sides, and command help together.

When adding browser capability, start at the extension permission/API boundary, expose the smallest protocol operation needed by the CLI, then design the CLI flags around user intent.


## Known Pitfalls / Footguns

Firefox WebExtensions are not ordinary Node programs. Browser APIs, permissions, background lifecycle, and message passing must stay behind extension-side adapters.

The CLI cannot inspect or mutate the active Firefox session without extension cooperation. Bypassing the extension risks controlling the wrong browser/profile or depending on unsupported Firefox internals.

Users can have mismatched CLI and extension versions. Include explicit protocol version checks before adding behavior that assumes both sides upgraded together.

Firefox does not provide Chrome CDP/debugger parity through WebExtensions. Implement browser control through Firefox extension APIs and content scripts, and return explicit unsupported-capability errors for Chrome-only commands.

## Maintaining This File

Keep `AGENTS.md` current when changing the project. Add durable, project-specific guidance that future developers and agents need for feature work; remove stale guidance promptly. Do not add temporary notes, changelog entries, generic development advice, machine-specific setup, or commands that are not backed by tracked files.
