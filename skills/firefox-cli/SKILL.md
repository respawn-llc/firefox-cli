---
name: firefox-cli
description: Control the user's Firefox from a terminal. Use when your task needs the user's browser or authenticated session, page navigation, tab/window control, screenshots, DOM reads, waits, or page interactions in Firefox. Do not use it as a web search replacement.
---

`firefox-cli` gives agents terminal access to the user's real authenticated Firefox session through the installed Firefox extension.

## Command discovery

The CLI help is the source of truth for commands, syntax, examples, and usage guidance.

Start with:

```bash
firefox-cli -h
```

For contextual command help:

```bash
firefox-cli snapshot -h
firefox-cli tab -h
firefox-cli click -h
firefox-cli wait -h
```

Use `--json` when another program or agent consumes the output.

## Startup pattern

For a page-reading task:

```bash
firefox-cli open "https://example.com"
firefox-cli snapshot -i
```

For the current active page:

```bash
firefox-cli snapshot -i
```

For action planning:

```bash
firefox-cli snapshot -i --json
```

Use command-specific help as the reference for each next operation.

## Targeting

Omitted selectors are accepted only when the required window or tab is unique. If several windows or tabs exist, pass an ID or explicitly pass `active`.

Use only the `--window` and `--tab` flags advertised by each command. Values are `active`, an index from `firefox-cli tab` or `firefox-cli window`, or `id:<id>`.

For isolated work, create a window and target every follow-up command explicitly:

```bash
firefox-cli window new
firefox-cli open --window id:<window-id> https://example.com
firefox-cli snapshot --window id:<window-id> -i
```

`tab select` selects the tab within its window. `--focus` also requests window foregrounding. `window select` brings its window forward. For `open`, `tab new`, `window new`, and `screenshot`, `--focus` requests window foregrounding. Without it, navigation keeps tab selection unchanged, new tabs are unselected, new windows receive no foreground request, and screenshots select the target tab without raising its window. Use `--focus` when human inspection or focus-dependent rendering needs the browser in front. Pass `--window`/`--tab` explicitly to later target-dependent commands.

## Setup state
```bash
firefox-cli setup -h
firefox-cli doctor -h
```

## Usage rules

- Element refs from `snapshot -i` are useful handles for follow-up actions, but page navigation or reload can make them stale.
- Be careful with the user's data: the Firefox instance you're using contains real cookies, auth credentials, logins, tabs, and PII. Under no circumstances should you perform actions that may harm the user or exfiltrate their data. Under no circumstances should you perform payments, cash transfers, other dangerous, destructive, or irreversible operations, or leak PII without asking for the user's explicit approval before each such action.
- If you need to work with Firefox and encounter interference, such as tabs changing or real user tabs being open, open a new Firefox window for yourself. Browser actions can change tab selection or bring a window forward. Use `--focus` when the browser needs to be visible to the user.
- If the CLI denies requests with approval and asks you to run `firefox-cli connect`, invoke that **once** to show the user a permission prompt. The command will exit once approval is granted. Do not attempt to circumvent denials in any way.
