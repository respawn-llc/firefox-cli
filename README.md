# firefox-cli

`firefox-cli` gives AI agents terminal-driven control over a user's normal Firefox session.
It is inspired by `agent-browser`, but targets Firefox users who cannot use Chrome-only browser-control stacks.

Firefox does not expose a CDP-like API for full control of a normal user session. `firefox-cli` uses a Firefox WebExtension plus a native messaging host so an agent can inspect pages, navigate, operate tabs and windows, interact with elements, read browser state, wait for page conditions, capture screenshots, observe logs/network activity, and run serial browser workflows from a CLI.

## Security Warning

Approving the `firefox-cli` extension grants the paired `firefox-cli` user full control over the Firefox browser session. That user may be an AI agent, a shell script, another local process, or a human operator.

After approval, treat `firefox-cli` as able to control all reachable Firefox windows, profiles, and tabs for that install: it can read page content, interact with authenticated websites, type into forms, operate downloads/uploads, read and write clipboard data, inspect cookies/storage where browser permissions allow it, and perform actions as the browser user.

Do not approve the pairing unless you accept responsibility for every actor that can run `firefox-cli` on the machine.

## Installation

Install the CLI package:

```sh
npm install -g firefox-cli
```

Print the extension path and native-host setup guidance:

```sh
firefox-cli setup
```

Install the extension shown by `firefox-cli setup`:

- Release packages include a signed `extension/firefox-cli.xpi`; open it in Firefox and accept the install prompt.
- Development checkouts use the unsigned extension directory in `dist/extension`; open `about:debugging#/runtime/this-firefox`, choose `Load Temporary Add-on`, and select `dist/extension/manifest.json`.

Register the native messaging host:

```sh
firefox-cli setup native-host
```

Open the `firefox-cli` extension popup in Firefox and approve the native host. The approval pairs the extension with the local native host and enables CLI requests from the machine.

Verify the installation:

```sh
firefox-cli doctor
```

`doctor` reports the native-host manifest state, extension connection state, approval state, and the next action when setup is incomplete.

## Agent Capabilities

`firefox-cli` is designed for AI agents that need a browser tool rather than a browser UI. It can target the active Firefox session, select tabs and windows, open and navigate pages, summarize page structure, resolve stable element references, click/type/fill/select/check/scroll, wait for browser and page conditions, collect diagnostics, and run multi-step batches with structured JSON output.

The control path is the user's real Firefox session, not a disposable automation-only profile. This lets agents work with the user's installed extensions, logged-in websites, cookies, local browser state, and ordinary windows after the user has approved the extension pairing.

Firefox-specific limits are explicit:

- Private windows are readable, but mutating commands are rejected.
- Page snapshots and element references target the main frame; cross-origin iframes are diagnostic only.
- Screenshots capture the visible tab and may activate the target tab or window.
- Browser-internal and privileged Firefox pages can block extension scripting.
- Unsupported Chrome-only capabilities return structured unsupported-capability errors.

See `docs/setup.md` for platform paths and troubleshooting, and `docs/commands.md` for command syntax.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run test:e2e
FIREFOX_CLI_E2E_DISPOSABLE=1 bun scripts/e2e-disposable-firefox.ts
```

`bun run test:e2e` does not launch Firefox unless `FIREFOX_CLI_E2E_DISPOSABLE=1` is set. See `docs/development.md` for local safety rules.

## License

AGPL-3.0-only. See `LICENSE`.
