import { commandSchemas, type Boundary, type CliRouteMetadata, type CommandId, type ComponentIdentity } from "./index.js";

export const boundaries: readonly Boundary[] = ["cli-to-host", "host-to-extension", "extension-to-content-script"];
export const inheritedCommandNames = ["toString", "constructor", "__proto__"] as const;

export const cliIdentity: ComponentIdentity = {
  component: "cli",
  productName: "firefox-cli",
  productVersion: "0.0.0",
  protocolMin: 1,
  protocolMax: 1,
  features: [],
};

export function uploadData(bytes: number): string {
  return Buffer.alloc(bytes).toString("base64");
}

export function commandIds(): CommandId[] {
  return Object.keys(commandSchemas).filter((command): command is CommandId => Object.hasOwn(commandSchemas, command));
}

export function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

export const expectedCliRoutesByCommand: Partial<Record<CommandId, readonly CliRouteMetadata[]>> = {
  capabilities: [{ id: "capabilities", path: ["capabilities"], batch: false }],
  "tabs.list": [{ id: "tab.list", path: ["tab"], batch: true }],
  "tab.new": [{ id: "tab.new", path: ["tab", "new"], batch: true }],
  "tab.select": [{ id: "tab.select", path: ["tab", "select"], batch: true }],
  "tab.close": [{ id: "tab.close", path: ["tab", "close"], batch: true }],
  "windows.list": [{ id: "window.list", path: ["window"], batch: true }],
  "window.new": [{ id: "window.new", path: ["window", "new"], batch: true }],
  "window.select": [{ id: "window.select", path: ["window", "select"], batch: true }],
  "window.close": [{ id: "window.close", path: ["window", "close"], batch: true }],
  open: [{ id: "open", path: ["open"], batch: true }],
  back: [{ id: "back", path: ["back"], batch: true }],
  forward: [{ id: "forward", path: ["forward"], batch: true }],
  reload: [{ id: "reload", path: ["reload"], batch: true }],
  snapshot: [{ id: "snapshot", path: ["snapshot"], batch: true }],
  "ref.resolve": [{ id: "ref", path: ["ref"], batch: true }],
  get: [{ id: "get", path: ["get"], batch: true }],
  is: [{ id: "is", path: ["is"], batch: true }],
  wait: [{ id: "wait", path: ["wait"], batch: true }],
  eval: [{ id: "eval", path: ["eval"], batch: true }],
  screenshot: [{ id: "screenshot", path: ["screenshot"], batch: true }],
  drag: [{ id: "drag", path: ["drag"], batch: true }],
  upload: [{ id: "upload", path: ["upload"], batch: true }],
  mouse: [{ id: "mouse", path: ["mouse"], batch: true }],
  keydown: [{ id: "keydown", path: ["keydown"], batch: true }],
  keyup: [{ id: "keyup", path: ["keyup"], batch: true }],
  find: [{ id: "find", path: ["find"], batch: true }],
  frame: [{ id: "frame", path: ["frame"], batch: true }],
  download: [{ id: "download", path: ["download"], batch: true }],
  dialog: [{ id: "dialog", path: ["dialog"], batch: true }],
  clipboard: [{ id: "clipboard", path: ["clipboard"], batch: true }],
  cookies: [{ id: "cookies", path: ["cookies"], batch: true }],
  storage: [{ id: "storage", path: ["storage"], batch: true }],
  network: [{ id: "network", path: ["network"], batch: true }],
  console: [{ id: "console", path: ["console"], batch: true }],
  errors: [{ id: "errors", path: ["errors"], batch: true }],
  highlight: [{ id: "highlight", path: ["highlight"], batch: true }],
  notify: [{ id: "notify", path: ["notify"], batch: true }],
  pdf: [{ id: "pdf", path: ["pdf"], batch: true }],
  "set.viewport": [{ id: "set.viewport", path: ["set", "viewport"], batch: true }],
  diff: [{ id: "diff", path: ["diff"], batch: true }],
  batch: [{ id: "batch", path: ["batch"], batch: false }],
  click: [{ id: "click", path: ["click"], batch: true }],
  dblclick: [{ id: "dblclick", path: ["dblclick"], batch: true }],
  focus: [{ id: "focus", path: ["focus"], batch: true }],
  hover: [{ id: "hover", path: ["hover"], batch: true }],
  fill: [{ id: "fill", path: ["fill"], batch: true }],
  type: [{ id: "type", path: ["type"], batch: true }],
  press: [{ id: "press", path: ["press"], batch: true }],
  "keyboard.type": [{ id: "keyboard.type", path: ["keyboard", "type"], batch: true }],
  "keyboard.inserttext": [{ id: "keyboard.inserttext", path: ["keyboard", "inserttext"], batch: true }],
  check: [{ id: "check", path: ["check"], batch: true }],
  uncheck: [{ id: "uncheck", path: ["uncheck"], batch: true }],
  select: [{ id: "select", path: ["select"], batch: true }],
  scroll: [{ id: "scroll", path: ["scroll"], batch: true }],
  scrollintoview: [{ id: "scrollintoview", path: ["scrollintoview"], batch: true }],
  swipe: [{ id: "swipe", path: ["swipe"], batch: true }],
} as const;
