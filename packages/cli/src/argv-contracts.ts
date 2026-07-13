import { getCliRouteEntries, type CliRouteSelectorDimensions } from "@firefox-cli/protocol";
import { CliUsageError, type CliRouteParserSpec } from "./types.js";

const targetValueOptions = ["--window", "--tab"] as const;
const jsonFlags = ["--json"] as const;
const selectorDimensionsByRouteId = new Map(getCliRouteEntries().map(({ route }) => [route.id, route.selectorDimensions]));

export const routeParserSpecs = {
  capabilities: parser("capabilities"),
  "tab.list": parser("tab"),
  "tab.new": parser("tab"),
  "tab.select": parser("tab"),
  "tab.close": parser("tab"),
  "window.list": parser("window"),
  "window.new": parser("window"),
  "window.select": parser("window"),
  "window.close": parser("window"),
  open: parser("open", { flags: ["--new-tab"] }),
  back: parser("back"),
  forward: parser("forward"),
  reload: parser("reload"),
  snapshot: parser("snapshot", {
    flags: ["-i", "--interactive", "-c", "--compact", "--verbose"],
    valueOptions: ["-d", "--depth", "-s", "--selector", "--max-output"],
  }),
  ref: parser("ref", { valueOptions: ["--generation"] }),
  get: parser("get", { valueOptions: ["--generation", "--max-output"] }),
  is: parser("is", { valueOptions: ["--generation"] }),
  wait: parser("wait", {
    valueOptions: ["--text", "--url", "--fn", "--load", "--state", "--generation", "--timeout", "--interval"],
    optionalValueOptions: ["--download"],
  }),
  eval: parser("eval", {
    flags: ["--stdin"],
    valueOptions: ["-b", "--base64", "--timeout", "--max-output"],
    allowDashDashPayload: true,
  }),
  screenshot: parser("screenshot", {
    flags: ["--full"],
    valueOptions: ["--timeout", "--max-output", "--format", "--screenshot-format", "--screenshot-quality"],
  }),
  drag: parser("drag"),
  upload: parser("upload", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2, variadicAfterMin: true },
  }),
  mouse: parser("mouse", {
    valueOptions: ["--x", "--y", "--button", "--delta-x", "--delta-y", "--generation"],
  }),
  keydown: parser("keydown", { valueOptions: ["--generation"] }),
  keyup: parser("keyup", { valueOptions: ["--generation"] }),
  find: parser("find", {
    flags: ["--first", "--last"],
    valueOptions: ["--nth"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  frame: parser("frame"),
  download: parser("download", { flags: ["--save-as"] }),
  dialog: parser("dialog", {
    payload: { payloadStartPositionals: 1, minPositionals: 1, variadicAfterMin: true },
  }),
  clipboard: parser("clipboard", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 1, variadicAfterMin: true },
  }),
  cookies: parser("cookies", {
    payload: { payloadStartPositionals: 2, minPositionals: 2, variadicAfterMin: true },
  }),
  storage: parser("storage", {
    payload: { payloadStartPositionals: 2, minPositionals: 2, variadicAfterMin: true },
  }),
  network: parser("network", { valueOptions: ["--url"] }),
  console: parser("console"),
  errors: parser("errors"),
  highlight: parser("highlight", { valueOptions: ["--generation", "--duration"] }),
  notify: parser("notify", {
    valueOptions: ["--id"],
    payload: { payloadStartPositionals: 0, minPositionals: 1, variadicAfterMin: true },
  }),
  pdf: parser("pdf"),
  "set.viewport": parser("set"),
  diff: parser("diff", {
    valueOptions: ["--selector"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  batch: parser("batch", {
    flags: ["--bail", "--stdin"],
    valueOptions: ["--timeout", "--max-output"],
  }),
  connect: parser("connect"),
  click: parser("click", { valueOptions: ["--generation"] }),
  dblclick: parser("dblclick", { valueOptions: ["--generation"] }),
  focus: parser("focus", { valueOptions: ["--generation"] }),
  hover: parser("hover", { valueOptions: ["--generation"] }),
  fill: parser("fill", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  type: parser("type", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  press: parser("press"),
  "keyboard.type": parser("keyboard", {
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  "keyboard.inserttext": parser("keyboard", {
    payload: { payloadStartPositionals: 1, minPositionals: 2 },
  }),
  check: parser("check", { valueOptions: ["--generation"] }),
  uncheck: parser("uncheck", { valueOptions: ["--generation"] }),
  select: parser("select", {
    valueOptions: ["--generation"],
    payload: { payloadStartPositionals: 1, minPositionals: 2, variadicAfterMin: true },
  }),
  scroll: parser("scroll", { valueOptions: ["--generation"] }),
  scrollintoview: parser("scrollintoview", { valueOptions: ["--generation"] }),
  swipe: parser("swipe", { valueOptions: ["--generation"] }),
} as const satisfies Readonly<Record<string, CliRouteParserSpec>>;

export type CliRouteParserSpecById = typeof routeParserSpecs;
export type CliRouteParserRouteId = keyof CliRouteParserSpecById;
const routeParserSpecsById = new Map<string, CliRouteParserSpec>(Object.entries(routeParserSpecs));

export interface ParsedCliRouteArgs {
  readonly positionals: readonly string[];
  readonly optionArgs: readonly string[];
  readonly json: boolean;
}

export const cliArgumentOptionInventory = buildOptionInventory(routeParserSpecs);

interface CliRouteArgParserState {
  readonly positionals: string[];
  readonly optionArgs: string[];
  json: boolean;
}

interface CliRouteArgContext {
  readonly parserSpec: CliRouteParserSpec;
  readonly routeId: string;
  readonly args: readonly string[];
  readonly state: CliRouteArgParserState;
}

export function parseCliRouteArgsForRoute(routeId: string, args: readonly string[]): ParsedCliRouteArgs {
  const parserSpec = routeParserSpecsById.get(routeId);
  if (parserSpec === undefined) {
    throw new Error(`CLI parser references unknown route: ${routeId}`);
  }
  return parseCliRouteArgs(withRouteSelectorOptions(parserSpec, routeId), routeId, args);
}

export function parseCliRouteArgv(parserSpec: CliRouteParserSpec, routeId: string, argv: readonly string[]): ParsedCliRouteArgs {
  return parseCliRouteArgs(withRouteSelectorOptions(parserSpec, routeId), routeId, argv.slice(1));
}

function parseCliRouteArgs(parserSpec: CliRouteParserSpec, routeId: string, args: readonly string[]): ParsedCliRouteArgs {
  const state: CliRouteArgParserState = {
    positionals: [],
    optionArgs: [],
    json: false,
  };
  const context: CliRouteArgContext = { parserSpec, routeId, args, state };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      continue;
    }

    if (arg === "--" && parserSpec.allowDashDashPayload === true) {
      state.positionals.push(...args.slice(index + 1));
      break;
    }

    if (parserSpec.flags.includes(arg)) {
      handleKnownFlag(context, arg, index);
      continue;
    }

    if (parserSpec.valueOptions.includes(arg)) {
      const consumedValue = handleKnownValueOption(context, arg, index);
      if (consumedValue) {
        index += 1;
      }
      continue;
    }

    if (isOptionalValueOption(parserSpec, arg)) {
      if (handleOptionalValueOption(context, arg, index)) {
        index += 1;
      }
      continue;
    }

    if (isTargetValueOption(arg)) {
      throw new CliUsageError(`Unsupported ${parserSpec.label} option: ${arg}`);
    }

    if (arg.startsWith("-")) {
      handleUnknownOption(context, arg);
      continue;
    }

    state.positionals.push(arg);
  }

  return { positionals: state.positionals, optionArgs: state.optionArgs, json: state.json };
}

function handleUnknownOption(context: CliRouteArgContext, arg: string): void {
  const { parserSpec, state } = context;
  if (isTargetValueOption(arg) || !canTreatUnknownOptionAsPayload(parserSpec, state.positionals.length)) {
    throw new CliUsageError(`Unsupported ${parserSpec.label} option: ${arg}`);
  }
  state.positionals.push(arg);
}

export function rejectTargetSelectorOptions(args: readonly string[], label: string): void {
  for (const arg of args) {
    if (isTargetValueOption(arg)) {
      throw new CliUsageError(`Unsupported ${label} option: ${arg}`);
    }
  }
}

function handleKnownFlag(context: CliRouteArgContext, arg: string, index: number): void {
  const { parserSpec, args, state } = context;
  if (shouldTreatKnownOptionAsPayload({ parserSpec, args, index, width: 1, currentPositionals: state.positionals.length })) {
    state.positionals.push(arg);
    return;
  }

  state.optionArgs.push(arg);
  if (arg === "--json") {
    state.json = true;
  }
}

function handleKnownValueOption(context: CliRouteArgContext, arg: string, index: number): boolean {
  const { parserSpec, routeId, args, state } = context;
  const value = args[index + 1];
  if (routeId === "select" && arg === "--generation" && value === undefined && canTreatUnknownOptionAsPayload(parserSpec, state.positionals.length)) {
    state.positionals.push(arg);
    return false;
  }

  if (shouldTreatKnownOptionAsPayload({ parserSpec, args, index, width: 2, currentPositionals: state.positionals.length })) {
    state.positionals.push(arg);
    return false;
  }

  if (value === undefined || value.startsWith("-")) {
    throw new CliUsageError(`Missing value for ${arg}.`);
  }
  state.optionArgs.push(arg, value);
  return true;
}

function handleOptionalValueOption(context: CliRouteArgContext, arg: string, index: number): boolean {
  const value = context.args[index + 1];
  if (value !== undefined && !value.startsWith("-")) {
    context.state.optionArgs.push(arg, value);
    return true;
  }
  context.state.optionArgs.push(arg);
  return false;
}

function isOptionalValueOption(parserSpec: CliRouteParserSpec, arg: string): boolean {
  return parserSpec.optionalValueOptions?.includes(arg) === true;
}

function parser(
  label: string,
  options: {
    readonly flags?: readonly string[];
    readonly valueOptions?: readonly string[];
    readonly optionalValueOptions?: readonly string[];
    readonly payload?: CliRouteParserSpec["payload"];
    readonly allowDashDashPayload?: boolean;
  } = {},
): CliRouteParserSpec {
  return {
    label,
    flags: [...jsonFlags, ...(options.flags ?? [])],
    valueOptions: [...(options.valueOptions ?? [])],
    ...(options.optionalValueOptions === undefined ? {} : { optionalValueOptions: options.optionalValueOptions }),
    ...(options.payload === undefined ? {} : { payload: options.payload }),
    ...(options.allowDashDashPayload === undefined ? {} : { allowDashDashPayload: options.allowDashDashPayload }),
  };
}

function withRouteSelectorOptions(parserSpec: CliRouteParserSpec, routeId: string): CliRouteParserSpec {
  const selectorDimensions = selectorDimensionsByRouteId.get(routeId);
  if (selectorDimensions === undefined) {
    throw new Error(`CLI parser references unknown protocol route: ${routeId}`);
  }

  return {
    ...parserSpec,
    valueOptions: [...selectorValueOptions(selectorDimensions), ...parserSpec.valueOptions],
  };
}

function selectorValueOptions(selectorDimensions: CliRouteSelectorDimensions): readonly string[] {
  if (selectorDimensions === "neither") {
    return [];
  }
  if (selectorDimensions === "window") {
    return [targetValueOptions[0]];
  }
  if (selectorDimensions === "tab") {
    return [targetValueOptions[1]];
  }
  return targetValueOptions;
}

function isTargetValueOption(arg: string): arg is (typeof targetValueOptions)[number] {
  return arg === targetValueOptions[0] || arg === targetValueOptions[1];
}

function shouldTreatKnownOptionAsPayload(context: {
  readonly parserSpec: CliRouteParserSpec;
  readonly args: readonly string[];
  readonly index: number;
  readonly width: number;
  readonly currentPositionals: number;
}): boolean {
  const { parserSpec, args, index, width, currentPositionals } = context;
  const payload = parserSpec.payload;
  if (payload === undefined || currentPositionals < payload.payloadStartPositionals) {
    return false;
  }

  return currentPositionals + Math.max(0, args.length - index - width) < payload.minPositionals;
}

function canTreatUnknownOptionAsPayload(parserSpec: CliRouteParserSpec, currentPositionals: number): boolean {
  const payload = parserSpec.payload;
  return (
    payload !== undefined &&
    currentPositionals >= payload.payloadStartPositionals &&
    (currentPositionals < payload.minPositionals || payload.variadicAfterMin === true)
  );
}

function buildOptionInventory(specs: Readonly<Record<string, CliRouteParserSpec>>): {
  readonly flags: ReadonlySet<string>;
  readonly valueOptions: ReadonlySet<string>;
  readonly optionalValueOptions: ReadonlySet<string>;
} {
  const flags = new Set<string>();
  const valueOptions = new Set<string>(targetValueOptions);
  const optionalValueOptions = new Set<string>();
  for (const spec of Object.values(specs)) {
    for (const flag of spec.flags) {
      flags.add(flag);
    }
    for (const option of spec.valueOptions) {
      valueOptions.add(option);
    }
    for (const option of spec.optionalValueOptions ?? []) {
      optionalValueOptions.add(option);
    }
  }

  return { flags, valueOptions, optionalValueOptions };
}
