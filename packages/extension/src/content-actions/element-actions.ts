import type { ElementActionParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult } from "../content-action-types.js";
import {
  assertEnabled,
  assertVisible,
  elementActionResult,
  resolveRequiredElement,
} from "./action-targets.js";
import { focusElement } from "./dom-events.js";

export function focusAction(options: ActionOptions, params: ElementActionParams): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertVisible(options, resolution.element);
  assertEnabled(options, resolution.element);
  focusElement(resolution.element);
  return elementActionResult(options, resolution);
}
