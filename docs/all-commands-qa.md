This test case exercises every user-facing `firefox-cli` command form exposed by the CLI parser. Run it against a disposable Firefox profile with the development extension and native host installed.

Use the local workflow fixture from `scripts/e2e-disposable-workflow.ts`, or an equivalent page with these controls:

- `#email`, `#name`, `#notes`, `#agree`, `#plan`, `#submit`, `#status`
- `#drag-source`, `#drop-target`, `#upload`, `#upload-status`
- `#key-target`, `#mouse-target`, `#clipboard-target`, `#highlight-target`
- an iframe, a scrollable `#feed`, and a downloadable `/download.txt`

Variables used below:

```sh
CLI=firefox-cli
BASE=http://127.0.0.1:<fixture-port>/
UPLOAD_FILE=/tmp/firefox-cli-upload-fixture.txt
PNG=/tmp/firefox-cli-visible.png
JPG=/tmp/firefox-cli-visible.jpg
PDF=/tmp/firefox-cli-output.pdf
```

Create `UPLOAD_FILE` with any small text payload. Capture IDs from JSON output where noted:

- `WINDOW`: Firefox window ID returned by `window new`.
- `TAB`: Firefox tab ID returned by `window new`.
- `TAB2`: Firefox tab ID returned by `tab new`.
- `TAB3`: Firefox tab ID returned by `open --new-tab`.
- `GEN`: snapshot generation ID.
- `REF`: snapshot ref for the `Submit E2E` button.
- `DL`: download ID returned by `download`.

## Steps

- [ ] Run `$CLI --version`; expect version text and exit code 0.
- [ ] Run `$CLI setup --json`; expect extension and native-host manifest paths.
- [ ] Run `$CLI setup native-host --dry-run --json`; expect a manifest plan and `"dryRun": true`.
- [ ] Run `$CLI setup native-host --json`; expect the disposable native-host manifest to be written.
- [ ] Run `$CLI doctor --json`; expect the disposable extension connection to be `"connected"`.
- [ ] Run `$CLI doctor --fix --json`; expect the manifest status to be healthy and the connection to remain `"connected"`.
- [ ] Run `$CLI capabilities --json`; expect MVP capabilities plus explicit unsupported entries.
- [ ] Run `$CLI window new "$BASE" --json`; save `WINDOW` and `TAB`.
- [ ] Run `$CLI window --json`; expect `WINDOW` in the window list.
- [ ] Run `$CLI window select "id:$WINDOW" --json`; expect `WINDOW` to be selected.
- [ ] Run `$CLI tab --window "id:$WINDOW" --json`; expect `TAB` in the tab list.
- [ ] Run `$CLI tab new "${BASE}?tab2" --window "id:$WINDOW" --json`; save `TAB2`.
- [ ] Run `$CLI tab select "id:$TAB2" --json`; expect `TAB2` to be active.
- [ ] Run `$CLI open "${BASE}?open" --tab "id:$TAB2" --json`; expect `TAB2` to navigate.
- [ ] Run `$CLI open --new-tab "${BASE}?tab3" --window "id:$WINDOW" --json`; save `TAB3`.
- [ ] Run `$CLI back --tab "id:$TAB2" --json`; expect navigation success.
- [ ] Run `$CLI forward --tab "id:$TAB2" --json`; expect navigation success.
- [ ] Run `$CLI reload --tab "id:$TAB2" --json`; expect reload success.
- [ ] Run `$CLI wait --load complete --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI wait --url "*open*" --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI wait 100 --json`; expect an elapsed wait result.
- [ ] Run `$CLI snapshot -i --tab "id:$TAB2" --json`; save `GEN` and the `Submit E2E` `REF`.
- [ ] Run `$CLI ref "$REF" --generation "$GEN" --tab "id:$TAB2" --json`; expect the button element.
- [ ] Run `$CLI get title --tab "id:$TAB2" --json`; expect `firefox-cli disposable E2E`.
- [ ] Run `$CLI get url --tab "id:$TAB2" --json`; expect a URL under `BASE`.
- [ ] Run `$CLI get text "#status" --tab "id:$TAB2" --json`; expect `Idle`.
- [ ] Run `$CLI get html main --tab "id:$TAB2" --json`; expect fixture markup.
- [ ] Run `$CLI get value "#email" --tab "id:$TAB2" --json`; expect an empty string.
- [ ] Run `$CLI get attr "#submit" type --tab "id:$TAB2" --json`; expect `button`.
- [ ] Run `$CLI get count button --tab "id:$TAB2" --json`; expect a positive number.
- [ ] Run `$CLI get box "#submit" --tab "id:$TAB2" --json`; expect numeric bounds.
- [ ] Run `$CLI get styles "#submit" --tab "id:$TAB2" --json`; expect computed style values.
- [ ] Run `$CLI is visible "#submit" --tab "id:$TAB2" --json`; expect `true`.
- [ ] Run `$CLI is enabled "#submit" --tab "id:$TAB2" --json`; expect `true`.
- [ ] Run `$CLI focus "#email" --tab "id:$TAB2" --json`; expect a `focus` action result.
- [ ] Run `$CLI fill "#email" "user@example.test" --tab "id:$TAB2" --json`; expect a `fill` action result.
- [ ] Run `$CLI type "#name" "Nikita" --tab "id:$TAB2" --json`; expect a `type` action result.
- [ ] Run `$CLI focus "#notes" --tab "id:$TAB2" --json`; expect a `focus` action result.
- [ ] Run `$CLI keyboard type "Ship" --tab "id:$TAB2" --json`; expect a `keyboard.type` action result.
- [ ] Run `$CLI keyboard inserttext " it" --tab "id:$TAB2" --json`; expect a `keyboard.inserttext` action result.
- [ ] Run `$CLI press Tab --tab "id:$TAB2" --json`; expect a `press` action result.
- [ ] Run `$CLI check "#agree" --tab "id:$TAB2" --json`; expect a `check` action result.
- [ ] Run `$CLI is checked "#agree" --tab "id:$TAB2" --json`; expect `true`.
- [ ] Run `$CLI uncheck "#agree" --tab "id:$TAB2" --json`; expect an `uncheck` action result.
- [ ] Run `$CLI check "#agree" --tab "id:$TAB2" --json`; expect the checkbox to be checked again.
- [ ] Run `$CLI select "#plan" pro --tab "id:$TAB2" --json`; expect `pro` in selected values.
- [ ] Run `$CLI hover "#submit" --tab "id:$TAB2" --json`; expect a `hover` action result.
- [ ] Run `$CLI dblclick "#submit" --tab "id:$TAB2" --json`; expect a `dblclick` action result.
- [ ] Run `$CLI click "#submit" --tab "id:$TAB2" --json`; expect a `click` action result.
- [ ] Run `$CLI wait --text "Submitted user@example.test" --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI wait "#status" --state visible --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI wait "#missing-control" --state hidden --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI wait --fn "Number(document.body.dataset.submits || 0) >= 1" --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI scroll down 120 "#feed" --tab "id:$TAB2" --json`; expect a `scroll` action result.
- [ ] Run `$CLI swipe up 20 "#feed" --tab "id:$TAB2" --json`; expect a `swipe` action result.
- [ ] Run `$CLI scrollintoview "#feed-bottom" --tab "id:$TAB2" --json`; expect a `scrollintoview` action result.
- [ ] Run `$CLI mouse move "#mouse-target" --x 2 --y 2 --tab "id:$TAB2" --json`; expect a `mouse` action result.
- [ ] Run `$CLI mouse down "#mouse-target" --button 0 --tab "id:$TAB2" --json`; expect a `mouse` action result.
- [ ] Run `$CLI mouse up "#mouse-target" --button 0 --tab "id:$TAB2" --json`; expect a `mouse` action result.
- [ ] Run `$CLI mouse wheel "#mouse-target" --delta-y 120 --tab "id:$TAB2" --json`; expect a `mouse` action result.
- [ ] Run `$CLI keydown A "#key-target" --tab "id:$TAB2" --json`; expect a `keydown` action result.
- [ ] Run `$CLI keyup A "#key-target" --tab "id:$TAB2" --json`; expect a `keyup` action result.
- [ ] Run `$CLI drag "#drag-source" "#drop-target" --tab "id:$TAB2" --json`; expect a `drag` action result.
- [ ] Run `$CLI upload "#upload" "$UPLOAD_FILE" --tab "id:$TAB2" --json`; expect one uploaded file.
- [ ] Run `$CLI get text "#upload-status" --tab "id:$TAB2" --json`; expect the upload filename.
- [ ] Run `$CLI find testid highlight-target --first --tab "id:$TAB2" --json`; expect one element.
- [ ] Run `$CLI frame --tab "id:$TAB2" --json`; expect one iframe diagnostic entry.
- [ ] Run `$CLI eval "document.title" --tab "id:$TAB2" --json`; expect the fixture title.
- [ ] Run `$CLI eval --base64 ZG9jdW1lbnQudGl0bGU= --tab "id:$TAB2" --json`; expect the fixture title.
- [ ] Run `printf 'document.title' | $CLI eval --stdin --tab "id:$TAB2" --json`; expect the fixture title.
- [ ] Run `$CLI screenshot "$PNG" --tab "id:$TAB2" --json`; expect a non-empty PNG file.
- [ ] Run `$CLI screenshot "$JPG" --format jpeg --screenshot-quality 80 --tab "id:$TAB2" --json`; expect a non-empty JPEG file.
- [ ] Run `$CLI screenshot "$PNG.full" --full --tab "id:$TAB2" --json`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI download "${BASE}download.txt" --json`; save `DL`.
- [ ] Run `$CLI wait --download "$DL" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI dialog status --tab "id:$TAB2" --json`; expect dialog command status.
- [ ] Run `$CLI dialog accept "ok" --tab "id:$TAB2" --json`; expect the documented dialog result.
- [ ] Run `$CLI dialog dismiss --tab "id:$TAB2" --json`; expect the documented dialog result.
- [ ] Run `$CLI clipboard write "clipboard-e2e" --json`; expect success.
- [ ] Run `$CLI clipboard read --json`; expect `clipboard-e2e`.
- [ ] Run `$CLI clipboard copy "#clipboard-target" --tab "id:$TAB2" --json`; expect copied text.
- [ ] Run `$CLI clipboard paste "#name" --tab "id:$TAB2" --json`; expect a paste action result.
- [ ] Run `$CLI cookies set "$BASE" phase all --json`; expect success.
- [ ] Run `$CLI cookies get "$BASE" phase --json`; expect the `phase` cookie.
- [ ] Run `$CLI cookies list "$BASE" --json`; expect the `phase` cookie in the list.
- [ ] Run `$CLI cookies remove "$BASE" phase --json`; expect success.
- [ ] Run `$CLI storage local set phase all --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI storage local get phase --tab "id:$TAB2" --json`; expect `all`.
- [ ] Run `$CLI storage session set phase all --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI storage session get phase --tab "id:$TAB2" --json`; expect `all`.
- [ ] Run `$CLI storage local remove phase --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI storage local clear --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI network clear --json`; expect success.
- [ ] Run `$CLI eval "fetch('${BASE}api/ping').then(r => r.json())" --tab "id:$TAB2" --json`; expect `{ "ok": true }`.
- [ ] Run `$CLI wait --load networkidle --tab "id:$TAB2" --timeout 5000 --json`; expect `"matched": true`.
- [ ] Run `$CLI network list --url "${BASE}api/ping" --json`; expect a request entry for `/api/ping`.
- [ ] Run `$CLI console clear --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI console list --tab "id:$TAB2" --json`; expect a console-list result.
- [ ] Run `$CLI errors clear --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI errors list --tab "id:$TAB2" --json`; expect an error-list result.
- [ ] Run `$CLI highlight "#highlight-target" --tab "id:$TAB2" --json`; expect success.
- [ ] Run `$CLI set viewport 1000 700 --tab "id:$TAB2" --json`; expect window dimensions in the response.
- [ ] Run `$CLI diff title "firefox-cli disposable E2E" --tab "id:$TAB2" --json`; expect `"matches": true`.
- [ ] Run `$CLI diff url "${BASE}?open" --tab "id:$TAB2" --json`; expect `"matches": true`.
- [ ] Run `$CLI batch '[["fill","#email","batch@example.test"],["click","#submit"],["wait","--text","Submitted batch@example.test","--timeout","5000"],["get","text","#status"]]' --tab "id:$TAB2" --json`; expect all batch steps to pass.
- [ ] Run `printf '[["get","title"]]' | $CLI batch --stdin --tab "id:$TAB2" --json`; expect the stdin batch step to pass.
- [ ] Run `$CLI pdf "$PDF" --tab "id:$TAB2" --json`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI close`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI quit`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI exit`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI connect`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI inspect`; expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI tab close "id:$TAB3" --json`; expect `TAB3` to close.
- [ ] Run `$CLI tab close "id:$TAB2" --json`; expect `TAB2` to close.
- [ ] Run `$CLI window close "id:$WINDOW" --json`; expect `WINDOW` to close.
- [ ] Run `$CLI unpair`; expect pair state to be cleared.

## Coverage

The 116 steps cover setup/diagnostics, native-host manifest planning and writing, pairing reset, capability reporting, tab/window lifecycle, navigation, snapshots, refs, getters, state checks, waits, eval input modes, visible screenshots, unsupported full-page screenshots, all implemented element actions, direct mouse and key events, upload/download, dialogs, clipboard, cookies, storage, network logs, console/error buffers, highlight, viewport, diff, argv/stdin batch modes, PDF unsupported behavior, and unsupported top-level browser-control commands.
