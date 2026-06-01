# AMO Source Review Build

This repository contains the source used to build the `FF-CLI Bridge` WebExtension. The npm package and CLI command are named `firefox-cli`.

Source repository: `https://github.com/respawn-llc/firefox-cli`

`FF-CLI Bridge` is free and open-source software under the AGPL-3.0-only license. The extension is distributed with the local `firefox-cli` package and communicates with the user-local native messaging host; it does not use a hosted backend service for browser control.

The extension manifest uses `https://opensource.respawn.pro/firefox-cli/updates.json` as its Firefox update manifest URL.

## Build Environment

- Operating system: macOS, Linux, or Windows.
- Bun: `1.3.14`, matching `packageManager` in `package.json`.
- Node.js: `>=22.0.0`, matching `engines.node` in `package.json`.
- Git: any recent version that can unpack the submitted source archive.

Install Bun from `https://bun.sh/docs/installation`. Bun installs dependencies from `bun.lock`; no npm, yarn, or pnpm lockfile is used.

## Build Steps

From the repository root:

```sh
bun install --frozen-lockfile
bun run extension:build
```

The build script executes the WebExtension build pipeline:

- `scripts/build-extension.ts`: runs Vite/Rollup on the TypeScript entry points.
- `scripts/copy-extension-assets.ts`: copies `manifest.json`, `popup.html`, and `popup.css`; `manifest.json` receives the release version from root `package.json`.
- `scripts/build-extension-archive.ts`: writes the unsigned add-on ZIP.

## Expected Output

After the build, the add-on files are in `dist/extension`:

- `background.js`
- `content.js`
- `popup.js`
- `manifest.json`
- `popup.html`
- `popup.css`

The unsigned add-on archive is:

```text
dist/extension-artifacts/firefox-cli-0.1.1.zip
```

The submitted source archive does not include `dist/` or `node_modules/`; both are generated locally from source and dependencies.

## Source Mapping

- `packages/extension/src/background.ts` builds to `dist/extension/background.js`.
- `packages/extension/src/content.ts` builds to `dist/extension/content.js`.
- `packages/extension/src/popup.ts` builds to `dist/extension/popup.js`.
- `packages/extension/src/manifest.json` is copied to `dist/extension/manifest.json` with the version synchronized from root `package.json`.
- `packages/extension/src/popup.html` and `packages/extension/src/popup.css` are copied to `dist/extension`.
- `docs/firefox-cli/updates.json` is the public update manifest published at `https://opensource.respawn.pro/firefox-cli/updates.json`.

Vite/Rollup bundles the TypeScript modules and esbuild minifies the generated JavaScript. Source files in this archive are not generated, concatenated, transpiled, or minified.
