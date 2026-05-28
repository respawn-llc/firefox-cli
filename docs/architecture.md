# Architecture

`firefox-cli` is split across four runtime boundaries:

- CLI: parses commands, prints terminal output, stores local configuration, and sends requests to the native host IPC endpoint.
- Native host: owns Firefox native messaging, local IPC, pair state, auth tokens, native-host manifest setup, and file writes for binary outputs such as screenshots.
- Extension: owns Firefox APIs, popup approval, tab/window targeting, content-script injection, command routing, and browser permission errors.
- Protocol: defines command IDs, request/response schemas, capability metadata, stable errors, and runtime validation.

## Transport

Firefox starts the native host through the native messaging manifest. The extension connects to that host and exchanges framed protocol messages. CLI invocations connect to the native host through a user-local IPC endpoint, authenticate with a user-local IPC token, and wait for one response.

Native-host stdout is reserved for Firefox native messaging frames. Human-readable diagnostics go through CLI mode or stderr.

## Pairing

The first popup approval creates a pair token. The extension stores the token in extension storage; the native host stores a hash and extension identity in user-local state. CLI requests are forwarded only when the connected extension has presented a valid token.

`firefox-cli unpair` clears native-host pair state. The extension popup can approve again and receive a new token.

## Targeting

Commands resolve targets inside the extension. Default target selection uses the active tab/window. Explicit targets use the indexes printed by `tab`/`window` or Firefox IDs with `id:<number>`.

Private windows are guarded at the extension command boundary. Read-only listings can report private tabs/windows; commands that would mutate private browsing state are rejected.

## Content Scripts

The extension injects content scripts on demand into normal web pages. Content scripts implement snapshots, element refs, getters, waits, and WebExtension-backed interactions. Refs belong to a document generation and are diagnostic handles, not durable selectors.

Firefox-restricted pages and some privileged pages reject script injection. The CLI reports these failures as protocol errors instead of trying to bypass Firefox restrictions.

## Capability Metadata

The protocol package is the single source of truth for shipped and gated capabilities. `firefox-cli capabilities --json` reports both supported commands and prototype-gated command families.

Unsupported command families fail with `UNSUPPORTED_CAPABILITY`. They are not silently mapped to browser-specific fallbacks.

## Packaging

The npm package contains:

- `bin/firefox-cli.js`, the user-facing launcher;
- `bin/<platform>/<binary>`, the native executable for the package platform;
- `lib/platform-binary.js`, runtime platform-binary resolution;
- `extension/development`, an unsigned extension directory for local loading;
- `extension/firefox-cli.xpi`, when a signed release extension artifact is packaged.

`doctor --fix` repairs native-host manifests after package moves or upgrades.

## Release Signing

Release candidates require a signed XPI. The signing workflow uses Mozilla Add-ons API credentials through `web-ext sign` with these secrets:

- `WEB_EXT_API_KEY`
- `WEB_EXT_API_SECRET`

`AMO_JWT_ISSUER` and `AMO_JWT_SECRET` are accepted by the local signing script as aliases. Store/public listing automation is not part of the package workflow; the signing channel is `unlisted`.
