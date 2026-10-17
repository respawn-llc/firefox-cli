This manual QA checklist exercises user-facing `firefox-cli` command forms. Run it in a dedicated Firefox test profile with the development extension and native host installed.

Prepare an HTTP test page with these controls and use its URL for `BASE`. Set the page title to `firefox-cli QA fixture`, label `#submit` as `Submit test`, make it display `Submitted <email> <name> <notes> <agreed> <plan>` in `#status`, and serve `/download.txt` as an attachment plus `/api/ping` as JSON containing `{"ok": true}`.

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
- `REF`: snapshot ref for the `Submit test` button.
- `DL`: download ID returned by `download`.

## Steps

- [ ] Run `$CLI --version`. Expect version text and exit code 0.
- [ ] Run `$CLI setup --json`. Expect an extension install URL and native-host manifest path.
- [ ] Run `$CLI setup native-host --dry-run --json`. Expect a manifest plan and `"dryRun": true`.
- [ ] Run `$CLI setup native-host --json`. Expect the disposable native-host manifest to be written.
- [ ] Run `$CLI doctor --json`. Expect the disposable extension connection to be `"connected"`.
- [ ] Run `$CLI doctor --fix --json`. Expect a healthy manifest status and a `"connected"` extension connection.
- [ ] Run `$CLI capabilities --json`. Expect MVP capabilities plus explicit unsupported entries.
- [ ] Run `$CLI connect`. Expect an already-approved rejection that identifies the extension instance.
- [ ] Run `$CLI window new "$BASE" --json`. Save `WINDOW` and `TAB`.
- [ ] Run `$CLI window --json`. Expect `WINDOW` in the window list.
- [ ] Run `$CLI window select "id:$WINDOW" --json`. Expect `WINDOW` to be brought forward without establishing a durable target.
- [ ] Run `$CLI tab --window "id:$WINDOW" --json`. Expect `TAB` in the tab list.
- [ ] Run `$CLI tab new "${BASE}?tab2" --window "id:$WINDOW" --json`. Save `TAB2`.
- [ ] Run `$CLI tab select "id:$TAB2" --json`. Expect `TAB2` to be selected without bringing its window forward or establishing a durable target.
- [ ] Run `$CLI open "${BASE}?open" --tab "id:$TAB2" --json`. Expect `TAB2` to navigate without changing the selected tab or bringing its window forward.
- [ ] Run `$CLI open --new-tab "${BASE}?tab3" --window "id:$WINDOW" --json`. Save `TAB3`.
- [ ] Run `$CLI back --tab "id:$TAB2" --json`. Expect navigation success.
- [ ] Run `$CLI forward --tab "id:$TAB2" --json`. Expect navigation success.
- [ ] Run `$CLI reload --tab "id:$TAB2" --json`. Expect reload success.
- [ ] Run `$CLI wait --load complete --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI wait --url "*open*" --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI wait 100 --json`. Expect an elapsed wait result.
- [ ] Run `$CLI snapshot -i --tab "id:$TAB2" --json`. Save `GEN` and the `Submit test` `REF`.
- [ ] Run `$CLI ref "$REF" --generation "$GEN" --tab "id:$TAB2" --json`. Expect the button element.
- [ ] Run `$CLI get title --tab "id:$TAB2" --json`. Expect `firefox-cli QA fixture`.
- [ ] Run `$CLI get url --tab "id:$TAB2" --json`. Expect a URL under `BASE`.
- [ ] Run `$CLI get text "#status" --tab "id:$TAB2" --json`. Expect `Idle`.
- [ ] Run `$CLI get html main --tab "id:$TAB2" --json`. Expect fixture markup.
- [ ] Run `$CLI get value "#email" --tab "id:$TAB2" --json`. Expect an empty string.
- [ ] Run `$CLI get attr "#submit" type --tab "id:$TAB2" --json`. Expect `button`.
- [ ] Run `$CLI get count button --tab "id:$TAB2" --json`. Expect a positive number.
- [ ] Run `$CLI get box "#submit" --tab "id:$TAB2" --json`. Expect numeric bounds.
- [ ] Run `$CLI get styles "#submit" --tab "id:$TAB2" --json`. Expect computed style values.
- [ ] Run `$CLI is visible "#submit" --tab "id:$TAB2" --json`. Expect `true`.
- [ ] Run `$CLI is enabled "#submit" --tab "id:$TAB2" --json`. Expect `true`.
- [ ] Run `$CLI focus "#email" --tab "id:$TAB2" --json`. Expect a `focus` action result.
- [ ] Run `$CLI fill "#email" "user@example.test" --tab "id:$TAB2" --json`. Expect a `fill` action result.
- [ ] Run `$CLI type "#name" "Nikita" --tab "id:$TAB2" --json`. Expect a `type` action result.
- [ ] Run `$CLI focus "#notes" --tab "id:$TAB2" --json`. Expect a `focus` action result.
- [ ] Run `$CLI keyboard type "Ship" --tab "id:$TAB2" --json`. Expect a `keyboard.type` action result.
- [ ] Run `$CLI keyboard inserttext " it" --tab "id:$TAB2" --json`. Expect a `keyboard.inserttext` action result.
- [ ] Run `$CLI press Tab --tab "id:$TAB2" --json`. Expect a `press` action result.
- [ ] Run `$CLI check "#agree" --tab "id:$TAB2" --json`. Expect a `check` action result.
- [ ] Run `$CLI is checked "#agree" --tab "id:$TAB2" --json`. Expect `true`.
- [ ] Run `$CLI uncheck "#agree" --tab "id:$TAB2" --json`. Expect an `uncheck` action result.
- [ ] Run `$CLI check "#agree" --tab "id:$TAB2" --json`. Expect the checkbox to be checked again.
- [ ] Run `$CLI select "#plan" pro --tab "id:$TAB2" --json`. Expect `pro` in selected values.
- [ ] Run `$CLI hover "#submit" --tab "id:$TAB2" --json`. Expect a `hover` action result.
- [ ] Run `$CLI dblclick "#submit" --tab "id:$TAB2" --json`. Expect a `dblclick` action result.
- [ ] Run `$CLI click "#submit" --tab "id:$TAB2" --json`. Expect a `click` action result.
- [ ] Run `$CLI wait --text "Submitted user@example.test" --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI wait "#status" --state visible --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI wait "#missing-control" --state hidden --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI wait --fn "Number(document.body.dataset.submits || 0) >= 1" --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI scroll down 120 "#feed" --tab "id:$TAB2" --json`. Expect a `scroll` action result.
- [ ] Run `$CLI swipe up 20 "#feed" --tab "id:$TAB2" --json`. Expect a `swipe` action result.
- [ ] Run `$CLI scrollintoview "#feed-bottom" --tab "id:$TAB2" --json`. Expect a `scrollintoview` action result.
- [ ] Run `$CLI mouse move "#mouse-target" --x 2 --y 2 --tab "id:$TAB2" --json`. Expect a `mouse` action result.
- [ ] Run `$CLI mouse down "#mouse-target" --button 0 --tab "id:$TAB2" --json`. Expect a `mouse` action result.
- [ ] Run `$CLI mouse up "#mouse-target" --button 0 --tab "id:$TAB2" --json`. Expect a `mouse` action result.
- [ ] Run `$CLI mouse wheel "#mouse-target" --delta-y 120 --tab "id:$TAB2" --json`. Expect a `mouse` action result.
- [ ] Run `$CLI keydown A "#key-target" --tab "id:$TAB2" --json`. Expect a `keydown` action result.
- [ ] Run `$CLI keyup A "#key-target" --tab "id:$TAB2" --json`. Expect a `keyup` action result.
- [ ] Run `$CLI drag "#drag-source" "#drop-target" --tab "id:$TAB2" --json`. Expect a `drag` action result.
- [ ] Run `$CLI upload "#upload" "$UPLOAD_FILE" --tab "id:$TAB2" --json`. Expect one uploaded file.
- [ ] Run `$CLI get text "#upload-status" --tab "id:$TAB2" --json`. Expect the upload filename.
- [ ] Run `$CLI find testid highlight-target --first --tab "id:$TAB2" --json`. Expect one element.
- [ ] Run `$CLI frame --tab "id:$TAB2" --json`. Expect one iframe diagnostic entry.
- [ ] Run `$CLI eval "document.title" --tab "id:$TAB2" --json`. Expect the fixture title.
- [ ] Run `$CLI eval --base64 ZG9jdW1lbnQudGl0bGU= --tab "id:$TAB2" --json`. Expect the fixture title.
- [ ] Run `printf 'document.title' | $CLI eval --stdin --tab "id:$TAB2" --json`. Expect the fixture title.
- [ ] Run `$CLI screenshot "$PNG" --tab "id:$TAB2" --json`. Expect a non-empty PNG of `TAB2`, with its window left in the background.
- [ ] Run `$CLI screenshot "$JPG" --format jpeg --screenshot-quality 80 --tab "id:$TAB2" --json`. Expect a non-empty JPEG file.
- [ ] Run `$CLI screenshot "$PNG.full" --full --tab "id:$TAB2" --json`. Expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI download "${BASE}download.txt" --json`. Save `DL`.
- [ ] Run `$CLI wait --download "$DL" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI dialog status --tab "id:$TAB2" --json`. Expect dialog command status.
- [ ] Run `$CLI dialog accept "ok" --tab "id:$TAB2" --json`. Expect the documented dialog result.
- [ ] Run `$CLI dialog dismiss --tab "id:$TAB2" --json`. Expect the documented dialog result.
- [ ] Run `$CLI clipboard write "clipboard-qa" --json`. Expect success.
- [ ] Run `$CLI clipboard read --json`. Expect `clipboard-qa`.
- [ ] Run `$CLI clipboard copy "#clipboard-target" --tab "id:$TAB2" --json`. Expect copied text.
- [ ] Run `$CLI clipboard paste "#name" --tab "id:$TAB2" --json`. Expect a paste action result.
- [ ] Run `$CLI cookies set "$BASE" phase all --json`. Expect success.
- [ ] Run `$CLI cookies get "$BASE" phase --json`. Expect the `phase` cookie.
- [ ] Run `$CLI cookies list "$BASE" --json`. Expect the `phase` cookie in the list.
- [ ] Run `$CLI cookies remove "$BASE" phase --json`. Expect success.
- [ ] Run `$CLI storage local set phase all --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI storage local get phase --tab "id:$TAB2" --json`. Expect `all`.
- [ ] Run `$CLI storage session set phase all --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI storage session get phase --tab "id:$TAB2" --json`. Expect `all`.
- [ ] Run `$CLI storage local remove phase --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI storage local clear --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI network clear --json`. Expect success.
- [ ] Run `$CLI eval "fetch('${BASE}api/ping').then(r => r.json())" --tab "id:$TAB2" --json`. Expect `{ "ok": true }`.
- [ ] Run `$CLI wait --load networkidle --tab "id:$TAB2" --timeout 5000 --json`. Expect `"matched": true`.
- [ ] Run `$CLI network list --url "${BASE}api/ping" --json`. Expect a request entry for `/api/ping`.
- [ ] Run `$CLI console clear --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI console list --tab "id:$TAB2" --json`. Expect a console-list result.
- [ ] Run `$CLI errors clear --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI errors list --tab "id:$TAB2" --json`. Expect an error-list result.
- [ ] Run `$CLI highlight "#highlight-target" --tab "id:$TAB2" --json`. Expect success.
- [ ] Run `$CLI set viewport 1000 700 --window "id:$WINDOW" --json`. Expect window dimensions in the response.
- [ ] Run `$CLI diff title "firefox-cli QA fixture" --tab "id:$TAB2" --json`. Expect `"matches": true`.
- [ ] Run `$CLI diff url "${BASE}?open" --tab "id:$TAB2" --json`. Expect `"matches": true`.
- [ ] Run `$CLI batch '[["fill","#email","batch@example.test"],["click","#submit"],["wait","--text","Submitted batch@example.test","--timeout","5000"],["get","text","#status"]]' --tab "id:$TAB2" --json`. Expect all batch steps to pass.
- [ ] Run `printf '[["get","title"]]' | $CLI batch --stdin --tab "id:$TAB2" --json`. Expect the stdin batch step to pass.
- [ ] Run `$CLI pdf "$PDF" --json`. Expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI close`. Expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI quit`. Expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI exit`. Expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI inspect`. Expect `UNSUPPORTED_CAPABILITY`.
- [ ] Run `$CLI tab close "id:$TAB3" --json`. Expect `TAB3` to close.
- [ ] Run `$CLI tab close "id:$TAB2" --json`. Expect `TAB2` to close.
- [ ] Run `$CLI window close "id:$WINDOW" --json`. Expect `WINDOW` to close.
- [ ] Run `$CLI unpair`. Expect pair state to be cleared.

## Coverage

The 116 steps cover setup/diagnostics, native-host manifest planning and writing, pairing reset, capability reporting, tab/window lifecycle, navigation, snapshots, refs, getters, state checks, waits, eval input modes, visible screenshots, unsupported full-page screenshots, all implemented element actions, direct mouse and key events, upload/download, dialogs, clipboard, cookies, storage, network logs, console/error buffers, highlight, viewport, diff, argv/stdin batch modes, PDF unsupported behavior, and unsupported top-level browser-control commands.
