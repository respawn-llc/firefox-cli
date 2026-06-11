import { createErrorResponse, type CommandId, type RequestEnvelope } from "@firefox-cli/protocol";
import type { CliDependencies } from "./index.js";

export function baseDependencies(): CliDependencies {
  return {
    version: "0.0.0",
    platform: "darwin",
    arch: "arm64",
    homeDir: "/Users/tester",
    binaryPath: "/opt/firefox-cli/bin/darwin-arm64/firefox-cli",
    packageRoot: "/opt/firefox-cli",
    cwd: "/work",
    fetchExtensionUpdates: async () => extensionUpdatesForVersion("0.0.0"),
    sendRequest: async (request) =>
      createErrorResponse(request.id, {
        code: "NATIVE_HOST_UNAVAILABLE",
        message: "firefox-cli native host is not running.",
      }),
    clearPairState: async () => undefined,
  };
}

export function extensionUpdatesForVersion(
  version: string,
  updateLink = `https://github.com/respawn-llc/firefox-cli/releases/download/v${version}/firefox-cli-${version}.xpi`,
) {
  return {
    addons: {
      "ff-cli-bridge@respawn.pro": {
        updates: [
          {
            version,
            update_link: updateLink,
          },
        ],
      },
    },
  };
}

export interface SetupDryRunOutput {
  readonly manifestPath: string;
  readonly manifest: {
    readonly path: string;
  };
}

export function parseSetupDryRunOutput(json: string): SetupDryRunOutput {
  const value: unknown = JSON.parse(json);

  if (!isRecord(value) || typeof value.manifestPath !== "string" || !isRecord(value.manifest) || typeof value.manifest.path !== "string") {
    throw new Error("Unexpected setup dry-run JSON shape.");
  }

  return {
    manifestPath: value.manifestPath,
    manifest: {
      path: value.manifest.path,
    },
  };
}

export function actionElement(role: string, name: string) {
  return {
    tagName: role === "button" ? "button" : "input",
    role,
    visible: true,
    name,
  };
}

export function phase8CliResultFor(request: RequestEnvelope): unknown {
  const element = actionElement("button", "Submit");
  const phase8Results: Partial<Record<CommandId, unknown>> = {
    drag: { action: "drag", ok: true, element },
    mouse: { action: "mouse", ok: true, element },
    keydown: { action: "keydown", ok: true, element },
    keyup: { action: "keyup", ok: true, element },
    upload: { action: "upload", ok: true, element, valueLength: 1 },
    find: { elements: [element] },
    frame: { frames: [] },
    download: { id: 1, filename: "file.txt", state: "complete" },
    dialog: { action: "accept", handled: true },
    clipboard: { action: "copy", ok: true, text: "Copied" },
    cookies: { action: "set", ok: true, cookie: { name: "sid", value: "1" } },
    storage: { area: "local", action: "set", ok: true },
    network: { action: "list", ok: true, requests: [] },
    console: { action: "list", ok: true, entries: [] },
    errors: { action: "clear", ok: true },
    highlight: { ok: true, element },
    notify: { ok: true, id: "approval" },
    pdf: { path: "/work/page.pdf" },
    "set.viewport": { window: { id: 7, index: 0, focused: true, tabCount: 1 } },
    diff: {
      kind: "title",
      expected: "Expected title",
      actual: "Expected title",
      matches: true,
    },
  };
  const result = phase8Results[request.command];

  if (result === undefined) {
    throw new Error(`Unexpected Phase 8 CLI test command: ${request.command}`);
  }

  return result;
}

export function targetSummary() {
  return {
    windowId: 7,
    windowIndex: 0,
    tabId: 42,
    tabIndex: 0,
    title: "Example",
    url: "https://example.com/",
  };
}

export function uploadData(bytes: number): string {
  return Buffer.alloc(bytes).toString("base64");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}
