# Technical Debt Plan

Scope: current tracked `firefox-cli` repository state. Focus on architecture, maintainability, security, correctness, and long-term project health. Exclude local ignored build artifacts and dependency installs.

## Highest Priority

- [x] Harden local IPC input limits in `packages/native-host/src/local-ipc.ts`.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: `sendLocalIpcRequest` writes one newline-delimited JSON payload at `packages/native-host/src/local-ipc.ts:153-178`; `readOneJsonLine` appends chunks to an unbounded string until newline at `packages/native-host/src/local-ipc.ts:227-270`.
  **Problem:** Local IPC accumulates socket data without a byte cap before JSON parsing or protocol validation. A malicious or broken local process can stream an unbounded line and grow native-host memory.
  **Fix:** Add a shared IPC frame/line size budget that is lower than the native messaging limit, abort reads once the budget is exceeded, close the socket, and return a structured `INVALID_ENVELOPE` or `OUTPUT_TOO_LARGE` response where an ID can be recovered. Cover both client and server paths with tests for oversized input, missing newline, and normal requests.

- [x] Resolve and bound pending native messaging requests in `packages/native-host/src/native-host-runtime.ts` and `packages/extension/src/background-controller.ts`.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: native host stores pending requests with `pending.set(request.id, ...)` at `packages/native-host/src/native-host-runtime.ts:54-79` and only rejects on connection close at `packages/native-host/src/native-host-runtime.ts:102-108`; extension stores `#pendingCommands` at `packages/extension/src/background-controller.ts:63-69`, schedules reconnect without draining at `packages/extension/src/background-controller.ts:268-273`, and adds pending commands at `packages/extension/src/background-controller.ts:298-316`.
  **Problem:** Both sides keep request promises in maps keyed by request ID without duplicate-ID protection, request timeouts, or complete cleanup on disconnect. Duplicate IDs can overwrite unresolved promises, stalled responses can leak entries, and native disconnects can leave extension callers waiting.
  **Fix:** Introduce a small request tracker abstraction with duplicate-ID rejection, per-request timeout/cancellation, disconnect cleanup, and deterministic structured transport errors. Use it from native-host and extension controller code, and add tests for duplicate IDs, timeout, native disconnect, extension disconnect, and response after timeout.

- [x] Replace inherited-property command checks in `packages/protocol/src/index.ts` with own-property validation.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: `commandSchemas` is a normal object at `packages/protocol/src/index.ts:1567-1863`; `isCommandId` uses `command in commandSchemas` at `packages/protocol/src/index.ts:2159-2161`; request parsing dereferences command schema after this guard at `packages/protocol/src/index.ts:2004-2015`.
  **Problem:** Inherited property names from untrusted messages can pass the command guard and crash or misroute validation.
  **Fix:** Use `Object.hasOwn(commandSchemas, command)` or a null-prototype command registry. Add protocol tests for prototype property names such as `toString`, `constructor`, and `__proto__` at request parsing and batch parsing boundaries.

- [x] Make missing target flag values fail fast in `packages/cli/src/index.ts`.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: `parseTargetOptions` reads `args[index + 1]` without requiring presence at `packages/cli/src/index.ts:2786-2796`; `parseTargetValue(undefined)` returns active target at `packages/cli/src/index.ts:2802-2805`.
  **Problem:** A truncated command containing `--window` or `--tab` can silently target the active tab or window.
  **Fix:** Require explicit values for `--window` and `--tab` by reusing `readFlagValue`, while still accepting the explicit value `active`. Add CLI tests for all command families that accept target options, especially destructive actions like `tab close`, `window close`, `cookies`, `storage`, and `clipboard`.

- [x] Validate persisted JSON state and manifest files before trusting casts.
  Source: direct observation with subagent corroboration.
  Evidence: pair state and host identity use `JSON.parse(... ) as PairState` / `as HostIdentity` at `packages/native-host/src/pair-state.ts:183-195` and `packages/native-host/src/pair-state.ts:241-253`; `doctor` manifest status parses to a cast object at `packages/cli/src/index.ts:1567-1603`; package checks parse package and extension manifests with casts at `scripts/package-check.ts:31-79`.
  **Problem:** Corrupt or tampered files can crash setup/doctor/startup flows or be treated as valid with missing fields.
  **Fix:** Add runtime schemas for native manifests, pair state, host identity, package manifests, and extension manifests. Return actionable invalid-state statuses from `doctor`, regenerate host identity when safe, clear unusable pair state only through explicit repair paths, and test malformed JSON, wrong shape, and stale-but-parseable files.

- [x] Upgrade or remediate the vulnerable `web-ext` dependency chain in root tooling.
  Source: directly observed from local package-manager checks.
  Evidence: `bun audit` reports `web-ext` transitive vulnerabilities in `tmp`, `ajv`, and `uuid`; `bun outdated` reports `web-ext` current `8.10.0` and latest `10.2.0`.
  **Problem:** The extension lint/signing toolchain currently brings in one high-severity and two moderate-severity advisories through transitive dependencies.
  **Fix:** Try upgrading `web-ext` to the latest compatible major and run `bun run extension:lint`, `bun run package:check`, and `bun run release:check`. If the major upgrade is blocked, pin safe transitive overrides or isolate extension linting in a locked tool wrapper with an explicit expiration ticket.

- [x] Add upload payload size limits across CLI, protocol, and content action code.
  Source: direct observation.
  Evidence: CLI reads every upload file fully and base64-encodes it at `packages/cli/src/index.ts:913-928`; `uploadFileSchema` only requires non-empty `dataBase64` at `packages/protocol/src/index.ts:1039-1050`; content action decodes every base64 string into bytes at `packages/extension/src/content-actions.ts:87-105`.
  **Problem:** Upload has a max file count but no per-file or total byte limit before memory allocation and cross-process transport.
  **Fix:** Define max per-file and total upload bytes in `packages/protocol`, validate decoded base64 length before transport, fail early in CLI before reading too much data, and test limit enforcement at CLI parsing, protocol schema, native messaging, and content action layers.

## Medium Priority

- [x] Consolidate command, parser, gating, batch, and timeout metadata into one source of truth.
  Source: direct observation with subagent corroboration.
  Evidence: CLI dispatch is a long hand-written chain at `packages/cli/src/index.ts:90-269`; batch CLI allow-list duplicates command names at `packages/cli/src/index.ts:1770-1819`; protocol command schemas live separately at `packages/protocol/src/index.ts:1567-1863`; gated capabilities live separately at `packages/protocol/src/index.ts:1927-1966`; protocol batch default-target logic covers only four commands at `packages/protocol/src/index.ts:2167-2195`; extension batch default-target and timeout logic has its own broader command lists at `packages/extension/src/browser-commands.ts:1042-1110`; network-idle uses `intervalMs` as `idleMs` at `packages/extension/src/browser-commands.ts:393-399`.
  **Problem:** Command behavior is duplicated across protocol, CLI, extension routing, batch execution, capability gating, help output, and timeout handling. These lists already differ and will drift further as commands are added.
  **Fix:** Extend protocol command metadata with command ownership, CLI aliases, batchability, target behavior, timeout/idle behavior, capability status, parser shape, and formatter category. Generate or consume dispatch/gating/batch allow-lists from that metadata, remove duplicated command lists, and add tests that every MVP command has parser coverage, extension handling, help visibility, batch policy, target policy, and capability output.

- [x] Split large god files along package ownership boundaries.
  Source: direct observation from file-size audit.
  Evidence: `packages/cli/src/index.ts` is about 3k LoC, `packages/protocol/src/index.ts` about 2.2k LoC, `packages/extension/src/browser-commands.ts` about 1.4k LoC, and `packages/extension/src/content-snapshot.ts` about 1.3k LoC.
  **Problem:** Large files mix registry data, parsing, routing, formatting, validation, and feature implementations, making command changes high-risk.
  **Fix:** Extract CLI command modules by command family with shared parser utilities, split protocol schemas by domain with an assembled registry, split browser handlers by browser/content/native-owned capabilities, and split content snapshot into accessibility, querying, log capture, formatting, and command routing modules. Keep public exports stable while moving tests with the extracted modules.

- [x] Implement real protocol negotiation instead of strict version equality everywhere.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: identity schemas expose `protocolMin` and `protocolMax` at `packages/protocol/src/index.ts:80-96`, but request and response parsing require exact `PROTOCOL_VERSION` equality at `packages/protocol/src/index.ts:1997-2002` and `packages/protocol/src/index.ts:2051-2056`.
  **Problem:** Any CLI/native-host/extension version skew causes hard failure even when a compatible range could exist.
  **Fix:** Define negotiated protocol state for CLI-to-host and host-to-extension sessions, store it on the connection, and validate subsequent envelopes against the negotiated version. Add tests for compatible overlap, no overlap, old CLI with new extension, and new CLI with old native host.

- [x] Scope network tracking per tab and per command target.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: `networkRequests` is one global array at `packages/extension/src/background.ts:5-14`; webRequest listeners capture `<all_urls>` without tab scoping at `packages/extension/src/background.ts:209-224`; listing and idle checks read global state at `packages/extension/src/background.ts:132-149` and `packages/extension/src/background.ts:239-249`; browser command network handling does not pass resolved target context at `packages/extension/src/browser-commands.ts:637-649`.
  **Problem:** Unrelated tabs can affect `network list` and `wait --load networkidle`, causing flaky waits and incorrect results.
  **Fix:** Track request state by tab ID and URL, pass resolved target context into the adapter, filter network list and idle checks by target, and ignore extension/internal requests. Add tests for two tabs where background traffic in one tab does not block or pollute another tab.

- [x] Bound content-script console and error capture buffers.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: append-only arrays are declared at `packages/extension/src/content-snapshot.ts:36-40`; console monkeypatch pushes entries at `packages/extension/src/content-snapshot.ts:525-545`; error listeners push entries at `packages/extension/src/content-snapshot.ts:557-574`.
  **Problem:** Long-lived or noisy tabs can leak memory in content scripts and produce very large `console` / `errors` command payloads.
  **Fix:** Replace arrays with bounded ring buffers that track entry count and encoded byte budget, expose truncation metadata, and add cleanup semantics for `console clear` / `errors clear`. Add tests for high-volume logs and retained ordering.

- [x] Extract robust process runner helpers for scripts and E2E.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: release launcher runner waits only for `exit` at `scripts/release-check.ts:203-225`; disposable E2E runner delegates spawn handling locally at `scripts/e2e-disposable-firefox.ts:347-356`; process cleanup scans `ps` output for a profile substring at `scripts/e2e-disposable-firefox.ts:468-483`; phase E2E hardcodes a macOS native-host manifest path at `scripts/e2e-phase2.ts:20-32`.
  **Problem:** Spawn failures can hang or produce unclear failures, cleanup can match by brittle process text, and E2E setup is not fully platform-aware.
  **Fix:** Add a shared script runner utility that handles `spawn` errors, stdout/stderr collection limits, process timeouts, and kill/cleanup. Track child PIDs directly, use platform-aware native manifest planning in E2E, and retain `ps` scanning only as a guarded stale-process fallback.

- [x] Validate signed extension artifacts, not just their existence.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: `package-check.ts` returns successfully when `extension/firefox-cli.xpi` exists at `scripts/package-check.ts:53-64`, and `requireSignedXpi` only checks access at `scripts/package-check.ts:56-58`.
  **Problem:** A wrong, stale, or corrupt signed XPI can pass release layout checks.
  **Fix:** Read the XPI as a ZIP, validate the manifest version, extension ID, background scripts, required permissions, and expected package version. Fail release checks when the signed artifact does not match the built package.

## Lower Priority

- [ ] Replace incomplete CSS escaping in content snapshot selectors.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: label lookup constructs a selector from raw ID text at `packages/extension/src/content-snapshot.ts:1073-1076`; `escapeCssString` only escapes backslashes and quotes at `packages/extension/src/content-snapshot.ts:1296-1298`.
  **Problem:** IDs containing CSS-special characters can break accessible-name lookup.
  **Fix:** Use `CSS.escape` when available and provide a standards-compliant fallback. Add snapshot tests for IDs with spaces, brackets, quotes, colons, and control-like characters.

- [ ] Make content action dispatch explicitly exhaustive.
  Source: subagent-assisted finding, verified directly against code.
  Evidence: `createContentActionResult` switches over command names with no default or `assertNever` branch at `packages/extension/src/content-actions.ts:23-67`.
  **Problem:** If the action command union drifts, invalid values can return `undefined` and fail later at protocol validation.
  **Fix:** Add an exhaustive helper that throws a controlled content action error, and add compile-time plus runtime tests that new action commands must be handled.

- [ ] Replace manual glob-to-regex helpers with a shared tested utility.
  Source: direct observation.
  Evidence: browser command code builds glob regexes at `packages/extension/src/browser-commands.ts:1368-1377`; background code has a separate implementation at `packages/extension/src/background.ts:351-355`.
  **Problem:** Duplicate glob conversion code can drift and produce different matching behavior for URLs, downloads, and network filters.
  **Fix:** Move glob matching to a small shared module with strict escaping and tests for wildcards, question marks, regex metacharacters, empty globs, and path/URL examples.

- [ ] Reduce direct DOM monkeypatching and mutation in content utilities where possible.
  Source: direct observation.
  Evidence: console capture replaces global console methods at `packages/extension/src/content-snapshot.ts:525-545`; highlight writes inline styles and dataset fields at `packages/extension/src/content-snapshot.ts:251-274`; upload creates partial `DataTransfer` / `FileList` shims at `packages/extension/src/content-actions.ts:701-733` and `packages/extension/src/content-actions.ts:736-764`.
  **Problem:** These invasive page mutations can conflict with target pages or browser behavior and are hard to clean up consistently.
  **Fix:** Isolate invasive page mutations behind explicit adapters with cleanup/restore behavior where feasible, document unavoidable WebExtension constraints, and add tests that repeated commands do not accumulate page-visible side effects unexpectedly.

## Review Log

- Created tracker and sized source-like files in the current working tree at roughly 25.2k lines across 90 files; scope is small enough for one-pass audit.
- Reviewed package layout, root scripts, public architecture docs, large files, protocol/CLI dispatch, extension browser/content handlers, native-host IPC/pairing/runtime code, packaging scripts, and E2E scripts.
- Ran `bun outdated`; notable major-version lag is `web-ext` `8.10.0` to `10.2.0`, with `vite`, `typescript`, and `@types/node` also having newer major lines.
- Ran `bun audit`; current dependency graph reports three vulnerabilities through `web-ext` transitive dependencies: one high and two moderate.
- Verified and rejected a subagent ZIP-compression finding: `scripts/build-extension-archive.ts` writes ZIP compression method `0` at local and central header method offsets, so the earlier DEFLATE mismatch claim was not retained.
- Merged adjacent command metadata, parser, gated capability, batch target, and wait-timeout findings into one root-cause ticket to keep the plan executable.
