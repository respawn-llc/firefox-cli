# firefox-cli

`firefox-cli` controls Firefox from a terminal through a WebExtension and a native messaging host. Commands run against the normal Firefox session after the extension and native host are installed and paired.

## Install

```sh
npm install -g firefox-cli
firefox-cli setup
firefox-cli setup native-host
```

Install the extension path printed by `firefox-cli setup`, approve the native host from the extension popup, then verify the connection:

```sh
firefox-cli doctor
firefox-cli tab
```

Development checkouts use the unsigned extension directory in `dist/extension`; release packages use `extension/firefox-cli.xpi` when the signed XPI is present. See `docs/setup.md` for platform paths and troubleshooting.

## Examples

```sh
firefox-cli tab --json
firefox-cli open --new-tab https://example.com
firefox-cli snapshot -i
firefox-cli get title
firefox-cli click "button[type=submit]"
firefox-cli fill "#email" "user@example.com"
firefox-cli wait --url "*example.com*"
firefox-cli eval "document.title" --json
firefox-cli screenshot page.png
```

Most commands accept `--tab active|<index>|id:<firefox-tab-id>` and `--window active|<index>|id:<firefox-window-id>`. Tab and window lists print the usable indexes in brackets.

## Command Surface

The command set covers setup/diagnostics, tab and window listing/selection/open/close, navigation, snapshots and refs, getters, state checks, waits, element interactions, direct mouse/key events, uploads, downloads, clipboard, cookies/storage, network logs, console/error capture, highlights, viewport sizing, diffs, visible PNG/JPEG screenshots, eval, and serial batches.

Firefox-specific limits are explicit:

- Private windows are readable, but mutating commands are rejected.
- Snapshots and element refs target the main frame; cross-origin iframes are diagnostic only.
- Screenshots are visible-tab captures and may activate the target tab/window; full-page screenshots return `UNSUPPORTED_CAPABILITY`.
- PDF export returns `UNSUPPORTED_CAPABILITY` because Firefox's WebExtension PDF API opens a browser save dialog instead of writing a requested CLI path.
- Network commands expose list/clear and network-idle waits; route/mock/block and HAR capture are unsupported.

See `docs/commands.md` for command syntax and `docs/architecture.md` for the transport and security model.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run test:e2e
FIREFOX_CLI_E2E_DISPOSABLE=1 bun scripts/e2e-disposable-firefox.ts
```

`bun run test:e2e` does not launch Firefox unless `FIREFOX_CLI_E2E_DISPOSABLE=1` is set. See `docs/development.md` for local safety rules.
