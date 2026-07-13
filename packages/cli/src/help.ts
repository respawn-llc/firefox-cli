import { getPositionals } from "./parse.js";
import { cliRouteBindings, findCliRouteBindingForArgv } from "./route-registry.js";

type RouteBindingId = keyof typeof cliRouteBindings;

interface HelpSpec {
  readonly summary: string;
  readonly guidance?: readonly string[];
}

interface HelpGroup {
  readonly title: string;
  readonly summary: string;
  readonly usage?: string;
  readonly routes: readonly RouteBindingId[];
}

const routeHelpSpecs = {
  capabilities: helpSpec("List supported command families and browser capability metadata."),
  connect: helpSpec("Request Firefox control approval through a dedicated approval page."),
  "tab.list": helpSpec("List tabs with indexes, ids, active state, titles, and URLs.", [
    "Use listed indexes with `--tab <index>` and ids with `--tab id:<id>`.",
  ]),
  "tab.new": helpSpec("Open a new tab, optionally at a URL."),
  "tab.select": helpSpec("Activate a tab by index, id, or URL substring."),
  "tab.close": helpSpec("Close a tab by index, id, or URL substring."),
  "window.list": helpSpec("List Firefox windows with indexes, ids, focus state, and tab counts.", [
    "Use listed indexes with `--window <index>` and ids with `--window id:<id>`.",
  ]),
  "window.new": helpSpec("Open a new Firefox window, optionally at a URL."),
  "window.select": helpSpec("Focus a Firefox window by index or id; it does not establish a durable CLI target."),
  "window.close": helpSpec("Close a Firefox window by index or id."),
  open: helpSpec("Navigate the active tab or create a new tab for a URL.", ["Use `--new-tab` when navigation must not replace the active page."]),
  back: helpSpec("Go back in the target tab history."),
  forward: helpSpec("Go forward in the target tab history."),
  reload: helpSpec("Reload the target tab."),
  snapshot: helpSpec("Read the target page as a compact text/JSON structure for agent context.", [
    "`-i` includes stable element refs for later actions such as click/fill/ref.",
    "`-s <selector>` scopes the snapshot to a subtree; `-d <depth>` bounds detail.",
  ]),
  ref: helpSpec("Resolve a snapshot element ref to current element details."),
  get: helpSpec("Read a page value such as title, URL, text, HTML, attribute, styles, or box geometry.", [
    "Pass a selector or `@ref` for element-scoped values.",
  ]),
  is: helpSpec("Check element/page state such as visible, enabled, checked, or selected."),
  wait: helpSpec("Wait for a duration, element, text, URL, function predicate, load state, or download.", [
    "Use waits between navigation/actions and reads instead of fixed sleeps.",
  ]),
  eval: helpSpec("Evaluate JavaScript in the target page and return a serialized result.", [
    "Use `--stdin` or `-b base64` for multi-line or shell-sensitive scripts.",
  ]),
  screenshot: helpSpec("Capture the visible target tab to a PNG/JPEG file or default path."),
  drag: helpSpec("Drag from one selector/ref to another."),
  upload: helpSpec("Attach one or more local files to a file input."),
  mouse: helpSpec("Send low-level mouse move/down/up/wheel events."),
  keydown: helpSpec("Send a keydown event, optionally to a selector/ref."),
  keyup: helpSpec("Send a keyup event, optionally to a selector/ref."),
  find: helpSpec("Find elements or frames by text, role, selector, or other supported lookup."),
  frame: helpSpec("List frame diagnostics for the target page."),
  download: helpSpec("Start a browser download from a URL and report download metadata."),
  dialog: helpSpec("Inspect, accept, or dismiss browser dialogs observed by the extension."),
  clipboard: helpSpec("Read/write clipboard text or copy/paste through focused page elements."),
  cookies: helpSpec("List, read, set, or remove cookies for a URL."),
  storage: helpSpec("Read, write, remove, or clear extension-accessible local/session storage."),
  network: helpSpec("List or clear network observations for a target tab/window."),
  console: helpSpec("List or clear captured console messages."),
  errors: helpSpec("List or clear captured page errors."),
  highlight: helpSpec("Temporarily highlight an element for visual inspection."),
  notify: helpSpec("Show a native Firefox notification with a title and optional message.", [
    "Use `--id <id>` to update or replace an existing notification with the same id.",
  ]),
  pdf: helpSpec("Report Firefox PDF export support for a target path."),
  "set.viewport": helpSpec("Resize the target window viewport."),
  diff: helpSpec("Compare URL, title, or snapshot content against an expected value."),
  batch: helpSpec("Run multiple CLI command arrays as one serial browser workflow.", [
    "Use `--bail` to stop after the first failed step.",
    "Batch steps use the same command words as normal CLI invocations.",
  ]),
  click: helpSpec("Click an element by CSS selector or snapshot `@ref`."),
  dblclick: helpSpec("Double-click an element by CSS selector or snapshot `@ref`."),
  focus: helpSpec("Focus an element by CSS selector or snapshot `@ref`."),
  hover: helpSpec("Move the pointer over an element by CSS selector or snapshot `@ref`."),
  fill: helpSpec("Set an input, textarea, or editable element value."),
  type: helpSpec("Type text into an element, preserving keyboard-like input behavior."),
  press: helpSpec("Press a keyboard key in the page or focused element."),
  "keyboard.type": helpSpec("Type text through the page keyboard target."),
  "keyboard.inserttext": helpSpec("Insert text through the page input target."),
  check: helpSpec("Check a checkbox or compatible control."),
  uncheck: helpSpec("Uncheck a checkbox or compatible control."),
  select: helpSpec("Select one or more option values in a select control."),
  scroll: helpSpec("Scroll a page or element in a direction by optional pixels."),
  scrollintoview: helpSpec("Scroll an element into view."),
  swipe: helpSpec("Alias directional scrolling for agent gestures."),
} as const satisfies Record<RouteBindingId, HelpSpec>;

const helpGroups: readonly HelpGroup[] = [
  {
    title: "Setup and diagnostics",
    summary: "Install, repair, inspect, and reset the Firefox/native-host connection.",
    routes: ["capabilities", "connect"],
  },
  {
    title: "Tabs, windows, and navigation",
    summary: "Choose browser targets, open pages, and move through history.",
    usage: "firefox-cli tab/window/open/back/forward/reload",
    routes: [
      "tab.list",
      "tab.new",
      "tab.select",
      "tab.close",
      "window.list",
      "window.new",
      "window.select",
      "window.close",
      "open",
      "back",
      "forward",
      "reload",
    ],
  },
  {
    title: "Read page state",
    summary: "Extract context for an agent before acting.",
    routes: ["snapshot", "ref", "get", "is", "find", "frame", "diff"],
  },
  {
    title: "Wait and observe",
    summary: "Synchronize on page/browser state and inspect diagnostics.",
    routes: ["wait", "network", "console", "errors", "dialog"],
  },
  {
    title: "Interact with pages",
    summary: "Operate elements and keyboard/mouse inputs.",
    usage: "firefox-cli click/fill/press/keyboard/mouse/...",
    routes: [
      "click",
      "dblclick",
      "focus",
      "hover",
      "fill",
      "type",
      "press",
      "keyboard.type",
      "keyboard.inserttext",
      "check",
      "uncheck",
      "select",
      "scroll",
      "scrollintoview",
      "swipe",
      "drag",
      "upload",
      "mouse",
      "keydown",
      "keyup",
      "highlight",
    ],
  },
  {
    title: "Browser data and files",
    summary: "Use browser-adjacent data and file operations.",
    routes: ["screenshot", "download", "clipboard", "cookies", "storage", "notify", "pdf", "set.viewport"],
  },
  {
    title: "Automation",
    summary: "Run structured multi-step workflows.",
    routes: ["batch", "eval"],
  },
];

const contextualGroupTopics: ReadonlyMap<string, HelpGroup> = new Map(
  helpGroups.flatMap((group): readonly (readonly [string, HelpGroup])[] => {
    if (group.title === "Tabs, windows, and navigation") {
      return ["tab", "window"].map((topic) => [topic, group] as const);
    }
    if (group.title === "Interact with pages") {
      return ["keyboard", "mouse"].map((topic) => [topic, group] as const);
    }
    return [];
  }),
);

const builtinHelpSpecs = new Map<string, HelpSpec>([
  [
    "setup",
    helpSpec("Print extension installation guidance or register the native messaging host.", [
      "`firefox-cli setup` prints the matching extension download URL and native-host setup command.",
      "`firefox-cli setup native-host` writes the per-user native messaging manifest.",
    ]),
  ],
  [
    "doctor",
    helpSpec("Diagnose or repair native-host registration and extension connection state.", [
      "`--fix` writes or repairs the native-host manifest when possible.",
      "`--json` returns machine-readable setup state for automation.",
    ]),
  ],
  ["unpair", helpSpec("Clear stored native-host pair state so Firefox can pair again.")],
]);

const commandExamples: Partial<Record<RouteBindingId, readonly string[]>> = {
  "tab.list": ["firefox-cli tab --json"],
  connect: ["firefox-cli connect"],
  "tab.new": ["firefox-cli tab new https://example.com"],
  "tab.select": ["firefox-cli tab select 1", "firefox-cli tab select id:42"],
  open: ["firefox-cli open https://example.com", "firefox-cli open --new-tab https://example.com"],
  snapshot: ["firefox-cli snapshot -i", "firefox-cli snapshot -s main -d 3 --json"],
  get: ["firefox-cli get title", "firefox-cli get text '#content' --json"],
  wait: ["firefox-cli wait --url '*dashboard*'", "firefox-cli wait '#ready'"],
  click: ["firefox-cli click 'button[type=submit]'", "firefox-cli click @e12"],
  fill: ["firefox-cli fill '#email' user@example.com"],
  notify: ["firefox-cli notify 'Action needed' 'Open Firefox to approve control'"],
  batch: ['firefox-cli batch \'[["open","https://example.com"],["snapshot","-i"]]\' --json'],
};

function helpSpec(summary: string, guidance: readonly string[] = []): HelpSpec {
  return { summary, guidance };
}

export function isHelpRequest(args: readonly string[]): boolean {
  return args.includes("-h") || args.includes("--help");
}

export function renderHelpForArgv(args: readonly string[]): string {
  const argsWithoutHelp = args.filter((arg) => arg !== "-h" && arg !== "--help");
  const positionals = getPositionals(argsWithoutHelp);

  if (positionals.length === 0) {
    return renderHelp();
  }

  const builtinSpec = builtinHelpSpecs.get(positionals[0] ?? "");
  if (builtinSpec !== undefined) {
    return renderBuiltinHelp(positionals[0] ?? "", builtinSpec);
  }

  const group = contextualGroupTopics.get(positionals[0] ?? "");
  const routeBinding = findCliRouteBindingForArgv(argsWithoutHelp);
  if (positionals.length === 1 && group !== undefined) {
    return renderGroupHelp(group);
  }

  if (routeBinding !== undefined && isRouteBindingId(routeBinding.route.id)) {
    return renderRouteHelp(routeBinding.route.id);
  }

  return renderHelp();
}

export function renderHelp(): string {
  return [
    "firefox-cli",
    "",
    "AI-agent control for the user's normal Firefox session.",
    "",
    "Common workflows:",
    "  Read a page:       firefox-cli open https://example.com && firefox-cli snapshot -i",
    '  Inspect content:   firefox-cli get title --json; firefox-cli find text "Sign in"',
    '  Act on elements:   firefox-cli click "button[type=submit]"; firefox-cli fill "#email" user@example.com',
    "  Manage targets:    firefox-cli tab; firefox-cli tab select 1; firefox-cli window",
    '  Synchronize:       firefox-cli wait --url "*dashboard*"; firefox-cli wait --load networkidle',
    '  Run a workflow:    firefox-cli batch \'[["open","https://example.com"],["snapshot","-i"]]\'',
    "",
    "Usage:",
    "  firefox-cli --version",
    "  firefox-cli <command> [args] [--json]",
    "  firefox-cli <command> -h",
    "",
    "Setup and diagnostics:",
    "  firefox-cli setup [--json]                              - print extension/native-host setup guidance",
    "  firefox-cli setup native-host [--dry-run] [--json]      - register the Firefox native messaging host",
    "  firefox-cli doctor [--fix] [--json]                     - diagnose or repair setup",
    "  firefox-cli unpair                                      - reset native-host pairing state",
    ...renderRouteGroupLines(helpGroups[0]),
    ...helpGroups.slice(1).flatMap((group) => ["", `${group.title}:`, ...renderRouteGroupLines(group)]),
    "",
    "Guidance:",
    "  Use `--json` when another program or agent consumes results.",
    "  Use `firefox-cli snapshot -i` before element actions to get stable `@ref` handles.",
    "  Use only the `--tab` and `--window` options advertised by each command; values are active, index, or id:<id>.",
    "  Use `firefox-cli <command> -h` for contextual command help.",
    "",
  ].join("\n");
}

function isRouteBindingId(routeId: string): routeId is RouteBindingId {
  return Object.hasOwn(cliRouteBindings, routeId);
}

function renderRouteGroupLines(group: HelpGroup | undefined): readonly string[] {
  if (group === undefined) return [];
  return group.routes.map((routeId) => {
    const binding = cliRouteBindings[routeId];
    return `  ${binding.help.padEnd(64)} - ${routeHelpSpecs[routeId].summary}`;
  });
}

function renderGroupHelp(group: HelpGroup): string {
  return [
    group.usage ?? group.title,
    "",
    group.title,
    "",
    group.summary,
    "",
    "Commands:",
    ...renderRouteGroupLines(group),
    "",
    "Guidance:",
    "  Add `--json` for machine-readable output.",
    "  Use only the selector options advertised by each command when the active target is not enough.",
    "",
  ].join("\n");
}

function renderRouteHelp(routeId: RouteBindingId): string {
  const binding = cliRouteBindings[routeId];
  const spec = routeHelpSpecs[routeId];
  return [
    binding.help,
    "",
    spec.summary,
    "",
    ...renderOptionalSection("Guidance:", spec.guidance),
    ...renderOptionalSection("Examples:", commandExamples[routeId]),
  ].join("\n");
}

function renderBuiltinHelp(command: string, spec: HelpSpec): string {
  return [
    command === "setup" ? "firefox-cli setup [native-host] [--dry-run] [--json]" : `firefox-cli ${command}`,
    "",
    spec.summary,
    "",
    ...renderOptionalSection("Guidance:", spec.guidance),
  ].join("\n");
}

function renderOptionalSection(title: string, lines: readonly string[] | undefined): readonly string[] {
  if (lines === undefined || lines.length === 0) return [];
  return [title, ...lines.map((line) => `  ${line}`), ""];
}
