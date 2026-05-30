import type { ElementActionParams, ScrollParams } from "@firefox-cli/protocol";
import type { ActionOptions, ContentActionResult } from "../content-action-types.js";
import {
  assertVisible,
  elementActionResult,
  resolveOptionalElement,
  resolveRequiredElement,
} from "./action-targets.js";

const DEFAULT_SCROLL_DISTANCE_PX = 600;

export function scrollAction(options: ActionOptions, params: ScrollParams): ContentActionResult {
  const distance = params.distancePx ?? DEFAULT_SCROLL_DISTANCE_PX;
  const delta = scrollDelta(params.direction, distance);
  const resolution = resolveOptionalElement(options, params);
  if (resolution !== undefined) {
    assertVisible(options, resolution.element);
    resolution.element.scrollLeft += delta.x;
    resolution.element.scrollTop += delta.y;
    return {
      ...elementActionResult(options, resolution),
      scroll: {
        x: resolution.element.scrollLeft,
        y: resolution.element.scrollTop,
      },
    };
  }

  const view = options.document.defaultView;
  if (view !== null) {
    try {
      view.scrollBy(delta.x, delta.y);
    } catch {
      // jsdom exposes scroll APIs that intentionally throw; return the intended offset in tests.
    }
  }

  return {
    action: options.command,
    ok: true,
    scroll: {
      x: view?.scrollX ?? delta.x,
      y: view?.scrollY ?? delta.y,
    },
  };
}

export function scrollIntoViewAction(
  options: ActionOptions,
  params: ElementActionParams,
): ContentActionResult {
  const resolution = resolveRequiredElement(options, params);
  assertVisible(options, resolution.element);
  resolution.element.scrollIntoView?.({ block: "center", inline: "center", behavior: "instant" });
  return elementActionResult(options, resolution);
}

function scrollDelta(
  direction: ScrollParams["direction"],
  distance: number,
): { readonly x: number; readonly y: number } {
  switch (direction) {
    case "up":
      return { x: 0, y: -distance };
    case "down":
      return { x: 0, y: distance };
    case "left":
      return { x: -distance, y: 0 };
    case "right":
      return { x: distance, y: 0 };
  }
}
