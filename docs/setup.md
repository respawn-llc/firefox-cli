# Setup

`firefox-cli` needs two installed pieces:

- the CLI/native host executable from the npm package;
- the Firefox extension that connects Firefox to the native host.

The CLI cannot inspect Firefox until the extension is loaded, the native messaging manifest is installed, and the extension popup has approved the pair.

## Install The CLI

```sh
npm install -g firefox-cli
firefox-cli setup
```

`firefox-cli setup` prints the extension download URL and native-host setup guidance. `firefox-cli setup --json` also includes the planned native-host manifest path.

Repository checkouts use:

```sh
bun install --frozen-lockfile
bun run package:check
node dist/package/bin/firefox-cli.js setup
```

## Install The Extension

Open the extension URL printed by `firefox-cli setup` in Firefox and accept the install prompt. The URL points at the signed XPI for the matching CLI version.

Repository checkouts can build an unsigned extension directory:

```sh
bun run extension:build
```

Open `about:debugging#/runtime/this-firefox`, choose `Load Temporary Add-on`, and select `dist/extension/manifest.json`.

## Register The Native Host

```sh
firefox-cli setup native-host
```

The command writes a per-user Firefox native messaging manifest. Use `--dry-run --json` to print the manifest without writing it.

Per-user manifest locations:

| Platform | Location |
| --- | --- |
| macOS | `~/Library/Application Support/Mozilla/NativeMessagingHosts/firefox_cli.json` |
| Linux | `~/.mozilla/native-messaging-hosts/firefox_cli.json` |
| Windows | `%APPDATA%\firefox-cli\native-messaging-hosts\firefox_cli.json`; `setup native-host` prints the required Firefox registry key |

After npm upgrades or package moves, run:

```sh
firefox-cli doctor --fix
```

`doctor --fix` repairs missing or stale native-host manifests.

## Approve Pairing

Run `firefox-cli approve` or open the `firefox-cli` extension popup in Firefox and approve the native host. The extension stores the pair token in Firefox extension storage; the native host stores pair state under the user-local `firefox-cli` state directory.

Verify the connection:

```sh
firefox-cli doctor
firefox-cli capabilities
firefox-cli tab
```

`doctor` exits non-zero when setup is incomplete and prints the next action.

## Troubleshooting

`Native host manifest: missing`
: Run `firefox-cli setup native-host` or `firefox-cli doctor --fix`.

`Native host manifest: stale`
: The manifest points at an old package path. Run `firefox-cli doctor --fix`.

`Extension connection: disconnected`
: Load or enable the extension and keep Firefox running.

`Extension connection: not-approved`
: Open the extension popup and approve the native host.

`Version mismatch`
: Upgrade or rebuild the CLI, native host, and extension from the same package version.

`SCRIPT_INJECTION_FAILED`
: Use a normal web page tab. Firefox blocks extension scripts on restricted internal pages and some privileged pages.

`UNSUPPORTED_CAPABILITY`
: The command family is not part of the supported Firefox command surface. Run `firefox-cli capabilities --json` for capability metadata.
