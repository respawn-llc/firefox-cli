import { actionResultSchema, type ActionKind, type ActionResult, type CommandParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult } from "./content-action-types.js";
import { focusAction } from "./content-actions/element-actions.js";
import { directMouseAction, dragAction, keyEventAction, mouseAction, pressAction } from "./content-actions/pointer-keyboard-actions.js";
import { checkAction, selectAction, uploadAction } from "./content-actions/selection-upload-actions.js";
import { scrollAction, scrollIntoViewAction } from "./content-actions/scroll-actions.js";
import { fillAction, keyboardTextAction, typeAction } from "./content-actions/text-editing-actions.js";

export function createActionResult(options: ActionOptions): ActionResult {
  return actionResultSchema.parse(createContentActionResult(options));
}

type ActionHandlerMap = {
  readonly [C in ActionKind]: (options: ActionOptions<C>, params: CommandParams<C>) => ContentActionResult;
};

const actionHandlers: ActionHandlerMap = {
  click: (options, params) => mouseAction(options, params, "click"),
  dblclick: (options, params) => mouseAction(options, params, "dblclick"),
  hover: (options, params) => mouseAction(options, params, "hover"),
  focus: focusAction,
  fill: fillAction,
  type: typeAction,
  "keyboard.type": keyboardTextAction,
  "keyboard.inserttext": keyboardTextAction,
  press: pressAction,
  check: (options, params) => checkAction(options, params, true),
  uncheck: (options, params) => checkAction(options, params, false),
  select: selectAction,
  scroll: scrollAction,
  swipe: scrollAction,
  scrollintoview: scrollIntoViewAction,
  drag: dragAction,
  upload: uploadAction,
  mouse: directMouseAction,
  keydown: keyEventAction,
  keyup: keyEventAction,
};
const supportedActionCommands: readonly string[] = Object.keys(actionHandlers);

function createContentActionResult<C extends ActionKind>(options: ActionOptions<C>): ContentActionResult {
  if (!supportedActionCommands.includes(options.command)) {
    throw options.createError("ACTION_REJECTED", `Unsupported content action: ${options.command}`);
  }
  const handler = actionHandlers[options.command];
  return handler(options, options.params);
}
