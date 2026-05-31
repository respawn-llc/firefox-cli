---
name: firefox-cli
description: Control the user's normal Firefox session from a terminal. Use when a task needs using the browser to perform work, user's browser context or authenticated session, navigation, tab/window control, screenshots, DOM reads, waits, or page interactions in Firefox.
---

## Purpose

`firefox-cli` gives agents terminal access to the user's real Firefox session through the installed Firefox extension and native host.

Use it when browser state matters and the task benefits from the user's normal Firefox profile, signed-in websites, active tabs, or real page behavior. Prefer it over starting a separate automation browser when the user asks to inspect, navigate, test, read, or manipulate pages in Firefox.

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

## When To Use

Good fits:
- Read the active page or a URL into agent context.
- Inspect page title, URL, text, element state, frames, console logs, errors, or network observations.
- Navigate Firefox, open pages, reload, move through history, or manage tabs/windows.
- Click, fill, type, press keys, scroll, upload files, or run a multi-step browser workflow.
- Capture screenshots or other browser-adjacent artifacts.
- Synchronize on page state with waits instead of fixed sleeps.

Poor fits:
- Tasks that only need HTTP fetching, static source code inspection, or public web search.
- Work that must run in an isolated disposable browser profile.
- Browser-internal or privileged Firefox pages that WebExtensions cannot script.

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

## Boundaries

- Element refs from `snapshot -i` are useful handles for follow-up actions, but page navigation or reload can make them stale.
- Respect CLI errors as the authority for unsupported pages, stale refs, setup gaps, and version mismatches.
