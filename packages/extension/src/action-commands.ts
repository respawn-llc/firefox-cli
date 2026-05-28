import type { ActionKind } from "@firefox-cli/protocol";

export const ACTION_COMMANDS: ReadonlySet<string> = new Set([
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
]);

export function isActionCommand(command: string): command is ActionKind {
  return ACTION_COMMANDS.has(command);
}
