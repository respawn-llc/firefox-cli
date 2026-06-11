# Commands

All commands use the paired Firefox session. Add `--json` for structured output where supported.

## Targets

Commands that operate on a page accept:

```sh
--tab active
--tab 0
--tab id:123
--window active
--window 0
--window id:456
```

Bare numeric targets are indexes printed by `firefox-cli tab` and `firefox-cli window`; `id:` targets use Firefox tab or window IDs.

Private windows are listed and readable. Mutating commands against private windows return `UNSUPPORTED_CAPABILITY`.

## Setup And Diagnostics

| Command | Behavior |
| --- | --- |
| `firefox-cli setup` | Print extension setup guidance and the native-host setup command. |
| `firefox-cli setup native-host [--dry-run] [--json]` | Write or print the native messaging manifest. |
| `firefox-cli doctor [--fix] [--json]` | Diagnose native-host manifest and extension connection state. |
| `firefox-cli unpair` | Clear CLI/native-host pair state. |
| `firefox-cli capabilities [--json]` | List supported and gated protocol capabilities. |

## Tabs, Windows, And Navigation

| Command | Behavior |
| --- | --- |
| `firefox-cli tab [--json]` | List tabs. |
| `firefox-cli tab new [url] [--json]` | Open a new tab. |
| `firefox-cli tab select [target] [--json]` | Select a tab. |
| `firefox-cli tab close [target] [--json]` | Close a tab. |
| `firefox-cli window [--json]` | List windows. |
| `firefox-cli window new [url] [--json]` | Open a new window. |
| `firefox-cli window select [target] [--json]` | Select a window. |
| `firefox-cli window close [target] [--json]` | Close a window. |
| `firefox-cli open [--new-tab] <url> [--json]` | Navigate the target tab or open a URL in a new tab. |
| `firefox-cli back|forward|reload [--json]` | Run browser navigation in the target tab. |

URLs without a scheme are normalized to `https://`.

## Snapshots And Refs

```sh
firefox-cli snapshot [-i] [-c] [-d depth] [-s selector] [--max-output bytes] [--json]
firefox-cli ref <@ref> [--generation id] [--json]
```

`snapshot` returns a text representation of the main-frame DOM and assigns element refs such as `@e1`. Refs are scoped to the reported generation ID; use `--generation` when consuming a ref after another snapshot has run. Iframe entries are diagnostic/read-only; iframe refs and frame-targeted commands are unsupported.

Options:

| Option | Behavior |
| --- | --- |
| `-i`, `--interactive` | Include interactive elements. |
| `-c`, `--compact` | Compact text output. |
| `--verbose` | Disable compact output. |
| `-d`, `--depth` | Limit traversal depth. |
| `-s`, `--selector` | Snapshot a subtree. |
| `--max-output` | Bound output bytes. |

## Getters And State

| Command | Behavior |
| --- | --- |
| `firefox-cli get title [--json]` | Get the target tab title. |
| `firefox-cli get url [--json]` | Get the target tab URL. |
| `firefox-cli get text <selector\|@ref> [--json]` | Get visible text. |
| `firefox-cli get html <selector\|@ref> [--json]` | Get HTML. |
| `firefox-cli get value <selector\|@ref> [--json]` | Get form value. |
| `firefox-cli get attr <selector\|@ref> <name> [--json]` | Get an attribute. |
| `firefox-cli get count <selector> [--json]` | Count matches. |
| `firefox-cli get box <selector\|@ref> [--json]` | Get bounding box. |
| `firefox-cli get styles <selector\|@ref> [--json]` | Get selected computed styles. |
| `firefox-cli is visible|enabled|checked <selector\|@ref> [--generation id] [--json]` | Check element state. |

Element getters accept `--generation id` for refs and `--max-output bytes` for large text/HTML output.

## Waits

| Command | Behavior |
| --- | --- |
| `firefox-cli wait <ms> [--json]` | Sleep for a duration. |
| `firefox-cli wait <selector\|@ref> [--state visible\|hidden\|attached] [--json]` | Wait for element state. |
| `firefox-cli wait --text <text> [--json]` | Wait for visible text. |
| `firefox-cli wait --url <glob> [--json]` | Wait for target URL match. |
| `firefox-cli wait --fn <js> [--json]` | Poll a page function until it returns a truthy value. |
| `firefox-cli wait --load domcontentloaded\|complete\|networkidle [--json]` | Wait for document readiness or background network idle. |
| `firefox-cli wait --download [id\|filename-glob] [--json]` | Wait for a download to complete. |

Waits accept `--timeout ms` and `--interval ms`.

## Interactions

| Command | Behavior |
| --- | --- |
| `firefox-cli click <selector\|@ref> [--json]` | Click an element. |
| `firefox-cli dblclick <selector\|@ref> [--json]` | Double-click an element. |
| `firefox-cli focus <selector\|@ref> [--json]` | Focus an element. |
| `firefox-cli hover <selector\|@ref> [--json]` | Dispatch a hover-like pointer sequence. |
| `firefox-cli fill <selector\|@ref> <text> [--json]` | Replace editable text. |
| `firefox-cli type <selector\|@ref> <text> [--json]` | Insert editable text. |
| `firefox-cli press <key> [--json]` | Press a key against the focused element. |
| `firefox-cli keyboard type|inserttext <text> [--json]` | Type text into the focused element. |
| `firefox-cli check|uncheck <selector\|@ref> [--json]` | Set checkbox/radio state. |
| `firefox-cli select <selector\|@ref> <value...> [--json]` | Select option values. |
| `firefox-cli scroll|swipe up|down|left|right [px] [selector\|@ref] [--json]` | Scroll page or element. |
| `firefox-cli scrollintoview <selector\|@ref> [--json]` | Scroll an element into view. |
| `firefox-cli drag <source-selector\|@ref> <target-selector\|@ref> [--json]` | Dispatch a drag/drop sequence. |
| `firefox-cli upload <selector\|@ref> <file...> [--json]` | Set files on a file input and dispatch change events. Each file is limited to 512,000 bytes; upload bytes are limited to 640,000 per command or across all upload steps in a batch. |
| `firefox-cli mouse move|down|up|wheel [selector\|@ref] [--json]` | Dispatch mouse or wheel events. |
| `firefox-cli keydown|keyup <key> [selector\|@ref] [--json]` | Dispatch key events. |

Element interactions accept `--generation id` for refs. They use WebExtension/content-script events, not OS-level input emulation.

## Eval, Screenshot, And Batch

```sh
firefox-cli eval <js> [--timeout ms] [--max-output bytes] [--json]
firefox-cli eval --stdin [--json]
firefox-cli eval --base64 <base64-js> [--json]
firefox-cli screenshot [path] [--format png|jpeg] [--screenshot-quality 1-100] [--timeout ms] [--max-output bytes] [--json]
firefox-cli batch <json> | --stdin [--bail] [--timeout ms] [--max-output bytes] [--json]
```

`eval` runs in the page main world and returns JSON-serializable values or `undefined`. Screenshot output captures the visible tab as PNG or JPEG; `--full` returns `UNSUPPORTED_CAPABILITY`.

`batch` accepts an array of protocol command objects or CLI argv arrays. Steps run serially. With `--bail`, execution stops after the first failed step; without it, later steps continue and the batch result reports failures.

Example:

```json
[
  ["snapshot", "-i"],
  ["click", "button[type=submit]"],
  { "command": "get", "params": { "kind": "title" } }
]
```

## Page And Browser Utilities

| Command | Behavior |
| --- | --- |
| `firefox-cli find role|text|label|placeholder|alt|title|testid <value> [--first\|--last\|--nth n] [--json]` | Find elements by semantic locator. |
| `firefox-cli frame [--json]` | List iframe diagnostics visible from the main frame. |
| `firefox-cli download <url> [filename] [--save-as] [--json]` | Start a Firefox download. |
| `firefox-cli dialog status|accept|dismiss [--json]` | Report dialog command status; native modal accept/dismiss is not available through content scripts. |
| `firefox-cli clipboard read|write|copy|paste [text-or-selector] [--json]` | Read/write clipboard text or copy/paste element text. |
| `firefox-cli cookies list|get|set|remove <url> [name] [value] [--json]` | Manage cookies for a URL. |
| `firefox-cli storage local|session get|set|remove|clear [key] [value] [--json]` | Manage page local/session storage. |
| `firefox-cli network list|clear [--url glob] [--json]` | List or clear observed web requests. |
| `firefox-cli console|errors list|clear [--json]` | List or clear page console/error capture buffers. |
| `firefox-cli highlight <selector\|@ref> [--json]` | Outline an element. |
| `firefox-cli notify [--id id] <title> [message...] [--json]` | Show a native Firefox notification. |
| `firefox-cli set viewport <width> <height> [--json]` | Request a target browser window resize and report Firefox's observed window dimensions. Tiling/window-manager rules can prevent the requested size from taking effect. |
| `firefox-cli diff url|title|snapshot <expected> [--json]` | Compare URL, title, or snapshot text with an expected value. |
| `firefox-cli pdf <path> [--json]` | Returns `UNSUPPORTED_CAPABILITY`; Firefox saves PDFs through a browser dialog rather than a requested CLI path. |

Network route/mock/block and HAR export are unsupported.

## Unsupported Families

The CLI returns `UNSUPPORTED_CAPABILITY` for unsupported command families and options, including `screenshot --full`, `pdf`, `connect`, `inspect`, top-level `close`, `quit`, and `exit`.
