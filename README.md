`firefox-cli` gives AI agents terminal-driven control over a user's normal Firefox session.
It is inspired by `agent-browser`, but for Firefox users. It talks to a Firefox extension so an agent can inspect pages, navigate, operate tabs and windows, interact with elements, read browser state, wait for page conditions, capture screenshots, observe logs/network activity, and run serial browser workflows from a CLI. using the real, authenticated user's session.

## Security Warning

Approving the `firefox-cli` extension grants the paired `firefox-cli` user full control over the Firefox browser session, including using & manipulating the signed-in sites, authentication, cookies, sensitive data & monitoring all activity. After approval, treat `firefox-cli` as able to control all reachable Firefox windows, profiles, and tabs.

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

Install the extension shown by `firefox-cli setup` - a signed `extension/firefox-cli.xpi`; open it in Firefox and accept the install prompt.

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

## Limitations 

Not everything that Chrome/CDP / `agent-browser` tools support is supported by Firefox:

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
Copyright (c) 2026 Nikita "Nek.12" Vaizin
