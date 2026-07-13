## Product Goal

`firefox-cli` gives AI agents and terminal users an `agent-browser`-style control surface for the user's real Firefox session. It controls already-running Firefox windows and tabs through a manually installed Firefox extension, not through a separate automation browser profile.

The CLI supports full browser control where Firefox WebExtensions allow it: navigation, tab/window selection, compact page snapshots with element refs, clicking, typing, filling, hovering, scrolling, swipe aliases, screenshots, waits, page queries, JavaScript evaluation, batch execution, and diagnostic output.

## Non-Goals

- Do not launch a dedicated automation-only Firefox profile for normal commands.
- Do not create persistent browser profiles, synthetic sessions, saved auth states, auth vaults, or cookie/storage snapshots in the MVP.
- Do not build AMO/public store distribution flows in the MVP.
- Do not build packaged agent skills until the CLI API shape is stable.
- Do not add domain allowlists, action policy files, or per-action confirmations in the MVP.
- Do not implement Chrome CDP/debugger-only capabilities unless Firefox provides an equivalent.
- Do not add OS-level input emulation unless content-script actions fail concrete target-site tests.
- Do not provide top-level `close`, `quit`, or `exit` commands in the MVP; require explicit `tab close` or `window close` because this controls the user's existing browser.

## User Experience

The happy path:

1. User installs the npm package and gets one executable: `firefox-cli`.
2. User manually installs or temporarily loads the Firefox extension from the URL printed by `firefox-cli setup`.
3. User runs `firefox-cli setup native-host` or `firefox-cli doctor --fix` to register the native messaging host.
4. User runs `firefox-cli connect` and responds to the Firefox approval request, or opens the extension popup and approves the first connection.
5. Commands control the active Firefox tab/window unless a command or flag selects another target.

Example workflow:

```bash
firefox-cli open https://example.com
firefox-cli snapshot -i
firefox-cli click @e3
firefox-cli fill @e4 "hello@example.com"
firefox-cli screenshot page.png
```

CLI output defaults to compact, LLM-readable text. `--json` returns typed protocol-shaped JSON for scripts and tests.

## Repository And Stack

Use Bun workspaces with TypeScript, strict typechecking, and ESM-first packages.

Package boundaries:

- `packages/protocol`: command schemas, request/response envelopes, runtime validation, version negotiation, error codes, and capability metadata.
- `packages/cli`: command parser, help text, text/JSON output formatting, setup/doctor UX, local IPC client, and packaging entrypoint.
- `packages/native-host`: native messaging stdio protocol, CLI-to-host IPC server, extension connection broker, pairing state, and OS-specific native manifest registration primitives.
- `packages/extension`: Firefox MV3 WebExtension, background script, popup UI, content scripts, browser API adapters, and extension build artifacts.
- `packages/test-support`: fake native host, fake extension transport, test pages, browser API mocks, and command fixtures.
- `docs`: user docs, setup guide, command reference, troubleshooting, and architecture notes.
- `scripts`: release/build automation that is not package-local.

Root scripts should own build, test, lint, typecheck, extension lint/build, native binary build, and package verification once package manifests exist.

## Architecture

The system has four layers:

- CLI process: parses commands, connects to the native-host broker over per-user local IPC, renders output, and exits.
- Native-host broker: is launched by Firefox through native messaging, verifies extension identity, exposes a per-user local IPC endpoint for CLI invocations, forwards protocol messages, and returns results.
- Extension background: owns Firefox APIs, target tab/window resolution, permission errors, command routing, popup state, native messaging connection, and content-script orchestration.
- Content scripts: run page-local actions and page analysis: snapshots, refs, DOM events, text/value/style queries, waits, eval, and frame-scoped work.

Use the same executable for CLI mode and native-host mode. Firefox launches the binary from the native messaging manifest. Native-host mode detection must be deterministic: expected native messaging argv shape, manifest path/name, extension ID, and native framing on stdin/stdout. Normal user invocations run CLI mode only when those native-host signals are absent. Host mode must reserve stdout for native messaging frames and write logs to stderr or files.

Default command target is the active tab in the active Firefox window. Commands that choose a tab or window use Firefox's real active state instead of hidden CLI sessions.

## Transport

Use Firefox native messaging as the preferred transport because it is designed for extension-to-native communication and can restrict the host to the project extension ID.

Native messaging setup:

- The extension requests `nativeMessaging`.
- The extension declares a stable Gecko add-on ID in `browser_specific_settings.gecko.id`.
- The CLI writes a native messaging manifest whose `allowed_extensions` contains only that add-on ID.
- Per-user native host registration is preferred over machine-global registration.
- macOS/Linux registration writes the manifest to the user-level Mozilla native messaging host path.
- Windows registration writes a `HKEY_CURRENT_USER\SOFTWARE\Mozilla\NativeMessagingHosts\<name>` key pointing to the manifest.
- The manifest points at the real platform executable, not an npm shim. `doctor --fix` repairs the manifest after npm package upgrades move the executable path.

Broker behavior:

- Extension background calls `runtime.connectNative()` in the unpaired state to discover host identity, and in the paired state to maintain the command channel.
- The native host stays alive while the extension's native messaging port is connected.
- The host exposes a per-user local IPC endpoint for `firefox-cli` invocations.
- CLI commands fail with actionable setup text when the extension is missing, not approved, disconnected, or unable to connect to the native host.
- Native messaging messages from native app to extension must stay small; large payloads should flow from extension to native host or through files because Firefox limits app-to-extension messages to 1 MB.

## Pairing, Approval, And Local IPC

MVP security posture is pairing-gated and command-permissive.

Unpaired handshake:

1. Extension connects to the native host.
2. Native host sends identity metadata: host name, executable path, package version, protocol min/max, native manifest path, extension ID, and a generated pairing nonce.
3. The extension approval UI asks the user to approve first use.
4. Until approval, the native host rejects CLI commands with `NOT_APPROVED`, except for the dedicated approval request command.
5. On approval, extension and native host persist the minimum pair state needed to reconnect.

After approval, all commands are allowed without per-action confirmations, domain allowlists, or action policies.

Local IPC rules:

- Use a per-user socket/pipe endpoint that is not reachable by other users.
- On Unix-like systems, use filesystem permissions and peer-credential checks where available.
- On Windows, use named-pipe ACLs restricted to the current user.
- Protect CLI-to-host requests with a generated pair token stored in user-local app state. Rotate it on `firefox-cli unpair`, extension reset, or pair-state mismatch.
- `firefox-cli unpair` clears host-side pair state; the popup reset action clears extension-side pair state.

Store pair state only in OS user-local application storage and extension-local storage. Do not store pair tokens, native-host paths, or approval state in the project repository, npm package directory, extension source tree, or generated native manifest. Pair state should include enough metadata to detect stale approvals, such as extension ID, host name, host executable identity, protocol range, and token generation. Rotate the token whenever either side resets approval, the host identity changes unexpectedly, or the extension/native-host pair cannot prove it is the same approved pair.

## MV3 Lifecycle Prototype Gate

Target Manifest V3 unless a prototype proves MV3 unusable for the required control channel. MV2 is only an escape hatch.

The MV3/native-host prototype passes only if commands recover or fail actionably after:

- Background idle/unload and wake.
- Firefox restart.
- Extension reload/update.
- Native-host crash or disconnect.
- System sleep/wake.
- CLI invocation before the extension reconnects.
- Protocol version mismatch between CLI, native host, and extension.

Implement reconnect/backoff in the extension background and native host. If these cases cannot be made reliable, evaluate localhost broker fallback or MV2 before changing the target architecture.

## Extension UX

Keep the extension UI smaller than a control panel. The popup should show:

- Connection status: extension loaded, native host registered, native host connected, approved/not approved.
- Last actionable error, if any.
- Setup guide with extension install/load step and native-host setup command.
- Approval/reset action for the first connection.
- Copy diagnostics action.

Do not mirror CLI commands in the popup. Setup text can tell users to run `firefox-cli connect` or click the Firefox extension popup to approve.

## Permissions

Use broad host access for the MVP full-control model after explicit first-use approval.

Expected manifest shape:

- `permissions`: native messaging, content scripting, tab access, local extension storage, downloads, cookies, notifications, clipboard, and web request observation.
- `host_permissions`: broad web access for normal web pages.
- `browser_specific_settings.gecko.strict_min_version`: Firefox `150.0`.
- `browser_specific_settings.gecko.data_collection_permissions`: browsing activity, website activity, and website content because command results can leave the extension through the local native host and CLI.

Command behavior:

- Check required permissions at startup and command time because users can revoke extension permissions.
- Translate permission failures into CLI errors that name the missing capability and required user action.
- Do not treat `activeTab` as a general CLI permission. Sensitive/browser UI capture or script injection that requires user activation should return an action-required or unsupported error unless an explicit user action grants it.

## Protocol

All CLI-extension messages go through `packages/protocol`.

Use a discriminated schema registry instead of stringly typed command routing:

```ts
type CommandSchema =
  | { command: "open"; params: OpenParams; result: OpenResult }
  | { command: "snapshot"; params: SnapshotParams; result: SnapshotResult }
  | { command: "click"; params: ClickParams; result: ActionResult }
```

Raw boundaries parse unknown JSON into validated envelopes. Runtime packages receive typed command IDs, typed params, typed results, and stable error unions generated or exported from `packages/protocol`.

Request envelope:

```ts
type RequestEnvelope<C extends CommandId = CommandId> = {
  protocolVersion: number
  id: string
  command: C
  target?: BrowserTarget
  params: CommandParams<C>
  output?: OutputOptions
}
```

Response envelope:

```ts
type ResponseEnvelope<C extends CommandId = CommandId> =
  | { protocolVersion: number; id: string; ok: true; result: CommandResult<C>; diagnostics?: Diagnostic[] }
  | { protocolVersion: number; id: string; ok: false; error: ProtocolError; diagnostics?: Diagnostic[] }
```

Protocol rules:

- Validate every incoming message at every process/browser boundary.
- Include a protocol version in every message.
- Return structured errors with stable codes such as `EXTENSION_NOT_CONNECTED`, `NOT_APPROVED`, `UNSUPPORTED_CAPABILITY`, `PERMISSION_DENIED`, `NO_ACTIVE_TAB`, `REF_NOT_FOUND`, `NAVIGATION_TIMEOUT`, `SCRIPT_INJECTION_BLOCKED`, and `VERSION_MISMATCH`.
- Include capability metadata so `firefox-cli capabilities` reports implemented and unsupported command groups.
- Keep command requests under the native app-to-extension message limit. Eval scripts support stdin/base64 but still enforce a documented max request size.

Startup handshake:

- CLI, native host, and extension exchange `hello` messages with product version, protocol min/max, extension ID, native-host name, and feature flags.
- The negotiated protocol version is the highest shared version.
- If there is no compatible version, commands fail with `VERSION_MISMATCH` and remediation text naming which component must be upgraded.

## Targeting

Target resolution is owned by the extension.

- `active` means Firefox's active tab in the active/focused normal window at command resolution time.
- Window and tab IDs use Firefox IDs in JSON output.
- Human-facing indexes are derived from deterministic `browser.windows.getAll({ populate: true })` ordering: focused window first, then remaining windows by Firefox window ID; tabs by index within each window.
- Private windows are reported but commands return `UNSUPPORTED_CAPABILITY` unless the extension has private browsing permission and the command is explicitly allowed there.
- Container tab metadata should be included when Firefox exposes it, but no persistent container/session model is added.
- Each command snapshots its resolved target before execution to avoid active-tab races.
- Selector values are `active`, a non-negative listing index, or `id:<non-negative Firefox ID>`. A route supports neither selector, `--window` only, `--tab` only, or both as advertised by its CLI help; unsupported selector flags fail before dispatch.
- Page-targeted routes support both dimensions. `tab new`, `window select`, and `window close` support `--window` only. Targetless routes support neither.
- `window select` changes Firefox focus only. It does not establish a durable CLI target; use an explicit selector on each isolated follow-up command.

`open <url>` navigates the resolved active tab to match `agent-browser`. Use `tab new [url]` or `open --new-tab <url>` to create a new tab.

## Snapshot And Ref Model

`snapshot` is the core LLM-efficient output format. It must not dump raw HTML by default.

Snapshot output should include:

- Page title and URL.
- A compact semantic tree with stable-for-generation element refs like `@e1`.
- Interactive elements by default with `snapshot -i`.
- Useful accessible names, roles, labels, placeholders, selected/checked/disabled state, hrefs, and input types.
- Iframe boundaries and diagnostics when frames are present.
- Clear truncation markers when output is clipped by `--max-output`.

Ref registry:

- The extension/content-script layer owns a bounded per-tab snapshot registry.
- Each snapshot creates a generation ID with tab ID, frame ID/document ID, timestamp, and ref mappings.
- Refs must survive separate CLI invocations until TTL expiry or invalidation.
- Invalidate refs on navigation, reload, frame reload, document replacement, or registry memory pressure.
- `batch` shares refs created earlier in the same batch transaction.
- Stale refs return `REF_NOT_FOUND` with "run `firefox-cli snapshot -i` again" guidance.
- Refs are actionable only in the main frame.
- Iframe output is diagnostic/read-only in `snapshot` and `frame`; iframe-targeted commands and interactions against iframe refs return `UNSUPPORTED_CAPABILITY`.

Implementation approach:

- Build snapshots from DOM, ARIA attributes, computed visibility, form metadata, and bounding boxes.
- Start with main-frame content-script snapshots.
- Restricted frames may produce partial output with diagnostics.

## Action Backend

MVP starts with WebExtension/content-script actions:

- Pointer actions are implemented through DOM element resolution, scrolling into view, focus, and synthetic mouse/pointer/click events where needed.
- Text entry uses value-setting plus input/change events for form controls, and keyboard/input event simulation for editable content where feasible.
- Click, hover, press, keyboard, fill, type, drag, upload, direct mouse commands, and raw key events are available for normal main-frame web controls with target-site limitations recorded in `docs/target-site-qa.md`.

Generated DOM events are not trusted user input. Sites that check `event.isTrusted`, require browser user activation, use complex editors, or implement anti-abuse controls may reject content-script actions. Track concrete failures; add OS-level input emulation only if these failures block the product.

## Eval Semantics

`eval` is included in MVP but must be explicitly specified and tested.

- Support `eval <js>`, `eval --stdin`, and `eval -b <base64>`.
- Execution target is the resolved tab's main frame.
- Frame-targeted eval returns `UNSUPPORTED_CAPABILITY`.
- Execute in the page/main world when Firefox supports it; otherwise return `UNSUPPORTED_CAPABILITY` for operations that require page-world access.
- Results must be structured-cloneable or JSON-serializable; unsupported values return a structured serialization error.
- Capture thrown errors with name, message, stack when available, and frame context.
- Enforce command timeout, script size limit, and result size limit.
- Restricted pages return `SCRIPT_INJECTION_BLOCKED`.

## Screenshot Semantics

Start with visible-tab screenshots.

- `screenshot [path]` captures the active visible tab of the target window.
- If the requested target is not active or focused, the command activates its tab and/or focuses its window before capture and reports those side effects in diagnostics. Invalid target resolution happens before activation.
- If activation is impossible or would require unsupported user activation, return `UNSUPPORTED_CAPABILITY`.
- Write image bytes through the native host to the requested path; JSON output should include path, format, dimensions when known, and diagnostics.
- Support visible-tab PNG and JPEG captures with JPEG quality.
- `--full` returns `UNSUPPORTED_CAPABILITY` because Firefox WebExtensions expose visible-tab capture APIs rather than a full-page file API.

## Batch And Concurrency

`batch` executes a serialized command transaction.

- Input is a JSON array of argv arrays or command objects.
- Default target is resolved once at batch start unless a step overrides it.
- Steps share ref registry entries created earlier in the batch.
- `--bail` stops at the first failed step.
- Output is an ordered result array with per-step success/error, diagnostics, and final exit status.
- Batch timeout is the outer deadline; each step may also have a timeout.

Concurrency rules:

- Serialize mutating commands per target tab.
- Allow independent read-only commands only when they do not mutate shared ref or wait state.
- Queue concurrent CLI invocations through the native host and return deterministic timeout/cancellation errors.

## CLI Surface And Capability Matrix

Keep command names close to `agent-browser` unless Firefox capability differences require a different command or explicit unsupported error.

Agent-browser family compatibility summary:

| Agent-browser family | `firefox-cli` status |
| --- | --- |
| Navigation: `open`, `back`, `forward`, `reload` | MVP |
| Browser/session close: `close`, `quit`, `exit`, `close --all` | Unsupported; use explicit `tab close` or `window close` |
| Snapshot/refs: `snapshot`, `frame` | MVP for main-frame refs and iframe diagnostics; actionable iframe refs unsupported |
| Core actions: `click`, `dblclick`, `fill`, `type`, `press`, `keyboard`, `hover`, `focus`, `check`, `uncheck`, `select`, `scroll`, `scrollintoview`, `swipe` | MVP for normal main-frame controls; target-site QA covers representative public click/fill/type/scroll actions and records x.com unauthenticated-headless limits |
| Advanced input: `drag`, `upload`, direct `mouse`, `keydown`, `keyup` | MVP with content-script event fidelity |
| Semantic locators: `find ...` | MVP |
| Read/check/wait: `get`, `is`, selector/text/URL/function/load/networkidle/download waits | MVP |
| Tabs/windows: `tab`, `window` | MVP |
| Capture: `screenshot` | MVP for visible-tab PNG/JPEG; full-page/PDF/video unsupported or deferred |
| Eval and batch: `eval`, `batch` | MVP |
| Dialogs, downloads, clipboard, cookies, storage, network list/clear | MVP with Firefox/WebExtension limits; HAR unsupported |
| Debug/repro: console/errors, `highlight`, diff, trace/profiler, vitals | MVP for listed commands; deferred as listed below |
| Auth/state/session/profile/security gates/content boundaries | Deferred or unsupported in MVP because this controls the existing Firefox session after pairing |
| Chrome/CDP/provider/browser-install features: CDP attach, `get cdp-url`, `inspect`, `--extension`, external providers, iOS, Chrome profile import, browser install/upgrade | Unsupported unless Firefox provides an equivalent |

Global options:

- `--json`: emit machine-readable JSON.
- `--timeout <ms>`: override command timeout.
- `--max-output <chars>`: cap text output.
- `--window <target>` and `--tab <target>`: route-specific target selectors; use only flags advertised by that route's help.
- `--debug`: include transport/protocol diagnostics.

Setup and diagnostics:

- `firefox-cli setup`: print extension download instructions and native-host setup status.
- `firefox-cli setup native-host`: register/update the native messaging host.
- `firefox-cli doctor`: diagnose extension install, native manifest, host path, extension connection, approval, Firefox status, and protocol version.
- `firefox-cli doctor --fix`: repair native-host registration when possible.
- `firefox-cli unpair`: remove local approval state.
- `firefox-cli capabilities`: list command support by capability group.

MVP:

- Navigation: `open`, `back`, `forward`, `reload`.
- Snapshot: `snapshot`, `snapshot -i`, `snapshot -c`, `snapshot -d <depth>`, `snapshot -s <selector>`.
- Stable interactions: `click`, `dblclick`, `focus`, `fill`, `type`, `press`, `keyboard type`, `keyboard inserttext`, `hover`, `check`, `uncheck`, `select`, `scroll`, `scrollintoview`.
- Swipe aliases: `swipe up|down|left|right [px]`, mapped to scrolling/pointer behavior where desktop Firefox supports it.
- Optional tap alias: `tap <selector|ref>` may alias `click` only if it does not imply mobile-device emulation.
- Information: `get text`, `get html`, `get value`, `get attr`, `get title`, `get url`, `get count`, `get box`, `get styles`.
- State checks: `is visible`, `is enabled`, `is checked`.
- Waits: `wait <selector|ref|ms>`, `wait --text`, `wait --url`, `wait --fn`, `wait --state hidden`, `wait --load domcontentloaded|complete`.
- Tabs/windows: `tab`, `tab new`, `tab close`, `tab select`, `window`, `window new`, `window close`, `window select`.
- Screenshots: visible-tab `screenshot [path]`.
- Eval: `eval <js>`, `eval --stdin`, `eval -b <base64>`.
- Batch: `batch` with JSON input and `--bail`.

Implemented with Firefox/WebExtension limits:

- `drag`.
- `upload`.
- Direct mouse commands: `mouse move`, `mouse down`, `mouse up`, `mouse wheel`.
- `keydown` and `keyup`.
- Semantic locators: `find role/text/label/placeholder/alt/title/testid/first/last/nth`.
- Frame listing. Cross-frame direct refs are unsupported.
- JPEG screenshot options.
- File downloads: `download`, `wait --download`.
- Dialogs: `dialog accept`, `dialog dismiss`, `dialog status`.
- Clipboard: `clipboard read/write/copy/paste`.
- Cookies and storage commands.
- Network request listing/filtering.
- `wait --load networkidle`.
- Console/error capture after injected instrumentation.
- `highlight`.
- PDF export returns `UNSUPPORTED_CAPABILITY` because Firefox saves PDFs through a browser dialog instead of writing a requested CLI path.
- Viewport/window sizing commands.
- Diff snapshot/screenshot/url.

Unsupported:

- Full-page screenshot stitching.
- Network route/mock/block, network request detail, and HAR capture.

Defer:

- Auth vault.
- Agent skill packaging.
- AI chat command.
- Content-boundary output markers and other prompt-injection hardening features.
- Dashboard/streaming UI.
- Video recording.
- Profiling/tracing.
- `pushstate`.
- `vitals` and `web-vitals`.
- Device emulation, proxy control, geolocation emulation, offline mode, custom headers, HTTP credentials.
- Browser install/upgrade commands.
- Persistent state/session commands.
- Browser profile listing/import commands.

Unsupported unless Firefox provides an equivalent:

- Top-level `close`, `quit`, `exit`, and `close --all`; use explicit `tab close` and `window close`.
- `confirm` and `deny`, because MVP has no per-action confirmation queue.
- Chrome `debugger`/CDP-specific commands.
- CDP attach by port/URL and `get cdp-url`.
- DevTools opening/inspection behavior equivalent to `agent-browser inspect`.
- Chrome extension loading flags such as `--extension`.
- External browser providers and iOS provider.
- Commands that require controlling pages where Firefox blocks extension injection.

## MVP Command Contracts

Every MVP command returns `{ target, diagnostics }` in JSON output. `target` includes resolved window ID, tab ID, URL when available, and title when available. Text output may omit fields that are not useful for agents.

Navigation:

- `open <url> [--new-tab]`: params are normalized URL and new-tab flag. Result is final target, URL, navigation status, and load state when known. Errors include invalid URL, no active tab, permission denied, navigation timeout, and unsupported restricted page.
- `back`, `forward`, `reload`: params are empty except target and timeout. Result is final URL and load state when known. Errors include no history entry, no active tab, navigation timeout, and restricted page.

Snapshot:

- `snapshot [-i] [-c] [-d <depth>] [-s <selector>]`: params are interactive-only, compact, max depth, selector scope, and max output. Result is text snapshot, generation ID, refs count, truncation flag, and frame diagnostics. Errors include script injection blocked, selector not found, permission denied, and output too large.

Interactions:

- `click`, `dblclick`, `focus`, `hover`, `check`, `uncheck`, `scrollintoview`: params are selector/ref plus action options. Result is action status, resolved element summary, and post-action URL if it changed. Errors include ref not found, selector not found, not visible, disabled, script injection blocked, and action rejected by page.
- `fill <selector|ref> <text>`: params are target and text. Result is action status plus resulting value length when readable. Errors include not editable, ref not found, selector not found, script injection blocked, and action rejected by page.
- `type <selector|ref> <text>`, `keyboard type <text>`, `keyboard inserttext <text>`: params are target when applicable, text, and input mode. Result is action status and focused element summary when available. Errors include no focused element, not editable, script injection blocked, and action rejected by page.
- `press <key>`: params are normalized key chord. Result is action status and focused element summary when available. Errors include invalid key, no focused element when focus is required, script injection blocked, and action rejected by page.
- `select <selector|ref> <value...>`: params are target and selected values. Result is selected values when readable. Errors include not a select control, option not found, ref not found, and script injection blocked.
- `scroll <direction> [px]` and `swipe <direction> [px]`: params are direction, distance, and optional selector/ref container. Result is scroll position when readable. Errors include invalid direction, ref not found, selector not found, and script injection blocked.

Information:

- `get text|html|value|attr|count|box|styles <selector|ref>`: params are getter type, target when required, and attribute name for `attr`. Result is the requested scalar/object with truncation metadata for large text/html. Errors include missing attr name, ref not found, selector not found, and script injection blocked.
- `get title` and `get url`: params are target only. Result is title or URL. Errors include no active tab and permission denied.

State checks:

- `is visible|enabled|checked <selector|ref>`: params are check type and target element. Result is boolean plus element summary. Errors include ref not found, selector not found, unsupported check, and script injection blocked.

Waits:

- `wait <selector|ref>`: waits for visible element by default. Result is matched element summary and elapsed time. Errors include timeout, ref not found, selector not found before timeout, and script injection blocked.
- `wait <ms>`: waits for duration. Result is elapsed time.
- `wait --text <text>`: waits for substring in visible document text. Result is match status and elapsed time.
- `wait --url <glob>`: waits for target tab URL to match. Result is final URL and elapsed time.
- `wait --fn <js>`: evaluates until truthy in the same execution mode as `eval`. Result is elapsed time and final truthy value when serializable.
- `wait --state hidden <selector|ref>`: waits for element to be absent or not visible. Result is elapsed time.
- `wait --load domcontentloaded|complete|networkidle`: waits for document readiness or background network idle.
- `wait --download [id|filename-glob]`: waits for a download to complete.

Tabs and windows:

- `tab`: lists tabs for the resolved or active window. Result includes ID, index, active flag, title, URL when permitted, window ID, private flag, and container metadata when available.
- `tab new [url]`: creates a new tab. Result is created tab target and URL when provided.
- `tab close [id|index|active]`: closes a tab. Result is closed tab ID and next active tab when known.
- `tab select <id|index>`: activates a tab. Result is selected target.
- `window`: lists normal windows and their active tabs. Result includes Firefox window IDs, focus/active flags, bounds when available, and tab count.
- `window new [url]`: creates a new window. Result is created window ID and active tab ID.
- `window close <id|active>`: closes a window. Result is closed window ID.
- `window select <id|index>`: focuses a window. Result includes refreshed focus metadata and its active tab; it does not set a durable default target.

Screenshots:

- `screenshot [path]`: params are output path, format, target, and timeout. Result is file path, format, dimensions when known, and activation side-effect diagnostics. Errors include no active tab, permission denied, capture blocked, unsupported non-active capture, and write failure.

Eval:

- `eval <js>`, `eval --stdin`, `eval -b <base64>`: params are script, encoding source, target, timeout, and size limits. Result is serialized value or `undefined` marker. Errors include syntax/runtime error, serialization failure, timeout, script injection blocked, unsupported execution world, and result too large.

Batch:

- `batch [--bail]`: params are ordered command steps, bail flag, default target, and timeout. Result is ordered step results, first failed index when any, and final exit status. Errors include invalid step, batch timeout, and concurrent target lock timeout.

## Error And Output UX

Errors should be concise and actionable:

- If extension is not installed: print the matching extension download URL.
- If native host is not registered: print `firefox-cli setup native-host`.
- If Firefox is not running or extension is disconnected: tell the user to open Firefox and run `firefox-cli connect`.
- If first-use approval is pending: tell the user to run `firefox-cli connect` or open the extension popup and approve.
- If a page is restricted: name the restriction and suggest trying a normal web page/tab.
- If a ref is stale: tell the user to run `firefox-cli snapshot -i` again.
- If a command is unsupported: name the Firefox limitation or missing implementation gate.

Default text output is for agents. JSON output is for programmatic scripts.

## Testing

Use Vitest for unit tests and Firefox-backed integration tests where needed.

Required test layers:

- Protocol schema/version/error tests in `packages/protocol`.
- CLI parser, help text, output formatter, and setup/doctor tests in `packages/cli`.
- Native manifest path/registry generation tests for macOS, Linux, and Windows in `packages/native-host`.
- Native messaging framing tests, including app-to-extension size-limit handling.
- Extension background command-routing tests with mocked browser APIs.
- Content-script tests for snapshot generation, ref lifecycle, interactions, waits, eval, and restricted-page errors.
- End-to-end tests that launch Firefox with the extension in a disposable profile, connect a native-host fixture, serve local test pages, and run real `firefox-cli` commands.

Required feasibility gates:

- MV3 idle/restart/reload/native-host crash recovery.
- Pairing, unpairing, token mismatch, and component reinstall behavior.
- Permission revocation and missing host permission errors.
- Restricted pages and restricted iframes.
- Active-tab screenshot side effects and failures.
- Cross-origin iframe partial snapshots.
- Native-host registration on macOS, Linux, and Windows.
- Clean npm install, package binary path, native manifest repair after upgrade, and release package verification.
- Target-site interaction smoke tests for x.com, linkedin.com, reddit.com, and representative rich-text/editor/upload flows before claiming action parity.

CI should run lint, typecheck, unit tests, extension lint, extension build, CLI build, and package verification on every change. Native host registration and IPC tests should run on macOS, Linux, and Windows in the release matrix.

## Development Commands

Expose root scripts with these roles once package manifests exist:

- `build`: build all packages.
- `typecheck`: typecheck all TypeScript.
- `lint`: run code lint plus extension lint.
- `test`: run unit tests.
- `test:e2e`: run Firefox extension/native-host integration tests.
- `extension:run`: load the extension into Firefox for development.
- `extension:build`: produce the extension package.
- `extension:sign`: sign the built extension through Mozilla Add-ons credentials.
- `package`: build the npm package artifacts.
- `release:check`: verify the package can install, register the native host, and print actionable setup state.
- `release:check:signed`: run release verification with signed XPI presence required.

Do not put exact command strings in AGENTS.md or docs until the scripts exist in tracked manifests.

## Packaging And Distribution

Publish an npm package named `firefox-cli` with one user-facing binary: `firefox-cli`.

The npm package should include or download platform-specific executable artifacts for macOS, Linux, and Windows. The executable must support:

- CLI mode for normal user commands.
- Native-host mode when launched by Firefox through the native messaging manifest.
- Setup/doctor mode for native-host manifest registration and diagnostics.

Package requirements:

- Native host manifest path points to the real executable path.
- Windows packages provide an `.exe` or wrapper suitable for the native manifest.
- Postinstall may print setup guidance but must not silently mutate Firefox configuration without an explicit setup command.
- `doctor --fix` handles moved package paths after npm upgrades.
- Host-mode stdout is reserved for native messaging frames.
- Release-candidate verification requires a signed `dist/extension-artifacts/firefox-cli-<version>.xpi` artifact and matching provenance.

Manual extension install is in scope; Mozilla store/public listing automation is out of scope.

Install paths:

- Development: temporary extension loading through Firefox tooling or `about:debugging`.
- Release/beta Firefox: signed XPI installed manually from project-provided artifact/URL.

## Documentation

MVP user-delivery docs are CLI help and setup/doctor output. Repository/release-support docs should include:

- `README.md`: install, setup, quickstart, command examples, support matrix, and troubleshooting.
- `docs/setup.md`: manual extension install/load, native-host registration, first-use approval, and platform-specific diagnostics.
- `docs/commands.md`: command reference with Firefox-specific differences from `agent-browser`.
- `docs/architecture.md`: transport, protocol, extension boundaries, native host, and capability decisions.

Do not ship packaged `skills get` docs until the command surface is stable.

## Reference Sources

- Firefox native messaging: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging
- Firefox native manifests: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests
- Firefox background scripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- Firefox content scripts: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts
- Firefox `scripting.executeScript()`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript
- Firefox `tabs.captureVisibleTab()`: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab
- Firefox permissions: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions
- Firefox Chrome incompatibilities: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities
- DOM event trust: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- Firefox Extension Workshop `web-ext`: https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/
- Firefox signing and distribution: https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/
