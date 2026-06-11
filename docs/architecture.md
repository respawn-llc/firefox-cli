# Architecture

`firefox-cli` is split across four runtime boundaries:

- CLI: parses commands, prints terminal output, stores local configuration, and sends requests to the native host IPC endpoint.
- Native host: owns Firefox native messaging, local IPC, pair state, auth tokens, native-host manifest setup, and file writes for binary outputs such as screenshots.
- Extension: owns Firefox APIs, first-use approval, tab/window targeting, content-script injection, command routing, and browser permission errors.
- Protocol: defines command IDs, request/response schemas, capability metadata, stable errors, and runtime validation.

## Transport

Firefox starts the native host through the native messaging manifest. The extension connects to that host and exchanges framed protocol messages. CLI invocations connect to the native host through a user-local IPC endpoint, authenticate with a user-local IPC token, and wait for one response.

Native-host stdout is reserved for Firefox native messaging frames. Human-readable diagnostics go through CLI mode or stderr.

## Pairing

The first approval request creates a pair token. The extension stores the token in extension storage; the native host stores a hash and extension identity in user-local state. CLI requests are forwarded only when the connected extension has presented a valid token.

`firefox-cli unpair` clears native-host pair state. Run `firefox-cli connect` to request approval again.

## Targeting

Commands resolve targets inside the extension. Default target selection uses the active tab/window. Explicit targets use the indexes printed by `tab`/`window` or Firefox IDs with `id:<number>`.

Private windows are guarded at the extension command boundary. Read-only listings can report private tabs/windows; commands that would mutate private browsing state are rejected.

## Content Scripts

The extension injects content scripts on demand into the main frame of normal web pages. Content scripts implement snapshots, element refs, getters, waits, and WebExtension-backed interactions. Refs belong to a document generation and are diagnostic handles, not durable selectors. Iframes are diagnostic/read-only through `snapshot` and `frame`; iframe-targeted execution is unsupported.

Firefox-restricted pages and some privileged pages reject script injection. The CLI reports these failures as protocol errors instead of trying to bypass Firefox restrictions.

## Capability Metadata

The protocol package is the single source of truth for shipped and unsupported capabilities. `firefox-cli capabilities --json` reports both supported commands and explicit Firefox/API limits.

Unsupported command families fail with `UNSUPPORTED_CAPABILITY`. They are not silently mapped to browser-specific fallbacks.

## Packaging

The npm package contains:

- `bin/firefox-cli.js`, the user-facing launcher;
- `bin/<platform>/<binary>`, the native executable for the package platform;
- `lib/platform-binary.js`, runtime platform-binary resolution;

The signed extension XPI is distributed through the update manifest URL reported by `firefox-cli setup`. The setup command selects the download whose extension version matches the CLI version.

`doctor --fix` repairs native-host manifests after package moves or upgrades.

## Release Signing

Release candidates require a signed XPI. The signing workflow uses Mozilla Add-ons API credentials through `web-ext sign` with these secrets:

- `WEB_EXT_JWT_ISSUER`
- `WEB_EXT_JWT_SECRET`

These values are Mozilla Add-ons JWT credentials: the issuer identifies the API credential, and the secret signs authenticated API calls. Store/public listing automation is not part of the package workflow; the signing channel is `unlisted`.
