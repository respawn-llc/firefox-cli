---
name: firefox-cli
description: Control the user's Firefox from a terminal. Use when your task needs the user's browser or authenticated session, page navigation, tab/window control, screenshots, DOM reads, waits, or page interactions in Firefox. Do not use it as a web search replacement.
---

`firefox-cli` gives agents terminal access to the user's real authenticated Firefox session through the installed Firefox extension.

## Command Discovery

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

## Startup Pattern

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

Then use the command-specific help for the next operation instead of relying on memory.

## Targeting

By default, commands target Firefox's active tab/window at command resolution time.

Use `firefox-cli tab -h` and `firefox-cli window -h` to discover targeting options. Use tab/window indexes and `id:<id>` values from `firefox-cli tab` and `firefox-cli window` output when the active target is not enough.

## Setup State
```bash
firefox-cli setup -h
firefox-cli doctor -h
```

## Usage Rules

- Element refs from `snapshot -i` are useful handles for follow-up actions, but page navigation or reload can make them stale.
- Be careful with the user's data: the Firefox instance you're using contains real cookies, auth credentials, logins, tabs, and PII. Under no circumstances should you perform actions that may harm the user or exfiltrate their data. Under no circumstances should you perform payments, cash transfers, other dangerous, destructive, or irreversible operations, or leak PII without asking for the user's explicit approval before each such action.
- If you need to work with Firefox, but you see interference, such as tabs changing or real user tabs being open, or the user is unhappy, prefer opening a new Firefox window for yourself. Every action you take is visibly reflected in the browser window and can disrupt the user's work. The upside is that you can demonstrate something to the user in their real browser, such as running demos, opening pages, or showing your work.
- If the CLI denies requests with approval and asks you to run `firefox-cli connect`, invoke that **once** to show the user a permission prompt. The command will exit once approval is granted. Do not attempt to circumvent denials in any way.
