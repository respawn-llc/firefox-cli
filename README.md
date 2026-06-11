`firefox-cli` gives AI agents terminal-driven **control over a user's Firefox** browser.

It is inspired by `agent-browser`, but for Firefox users. It talks to a Firefox extension so an agent can inspect pages, navigate, operate tabs and windows, interact with elements, read browser state, wait for page conditions, capture screenshots, observe logs/network activity, and run serial browser workflows from a CLI using the real, authenticated user's session.

## Installation

Install the CLI package:

```sh
npm install -g firefox-cli
```

Print the extension download URL and native-host setup guidance:

```sh
firefox-cli setup
```

Install the extension from the URL shown by `firefox-cli setup`; open it in Firefox and accept the install prompt. The URL is selected from the update manifest for the matching CLI version.

Register the native messaging host:

```sh
firefox-cli setup native-host
```

Run `firefox-cli connect` and respond to the approval request in Firefox. The approval pairs the extension with the local native host and enables CLI requests from the machine.

Verify the installation:

```sh
firefox-cli doctor
```

`doctor` reports the native-host manifest state, extension connection state, approval state, and the next action when setup is incomplete.

## Agent Skill

Install the agent skill so coding agents know when `firefox-cli` is available and how to use it.

### Claude Code

Add the Respawn marketplace, then install the plugin:

```text
/plugin marketplace add respawn-llc/claude-plugin-marketplace
/plugin install firefox-cli@respawn-tools
```

### Codex

Install the skill from the public GitHub path:

```text
$skill-installer install https://github.com/respawn-llc/firefox-cli/tree/main/skills/firefox-cli
```

## Security Warning

Approving the `firefox-cli` extension grants the paired `firefox-cli` user **full control over the Firefox browser** session, including using & manipulating the signed-in sites, **authentication, cookies, sensitive data** & monitoring all activity. Do not approve the pairing unless you accept responsibility for every actor that can run `firefox-cli` on the machine.

## Limitations 

Not everything that Chrome/CDP / `agent-browser` tools support is supported by Firefox:

- Private windows are readable, but mutating commands are rejected.
- Page snapshots and element references target the main frame; cross-origin iframes are diagnostic only.
- Screenshots capture the visible tab and may activate the target tab or window.
- Browser-internal and privileged Firefox pages can block extension scripting.

See `docs/setup.md` for platform paths and troubleshooting, and `docs/commands.md` for command syntax.

## License

AGPL-3.0-only. See `LICENSE`.

Copyright (c) 2026 Respawn LLC
