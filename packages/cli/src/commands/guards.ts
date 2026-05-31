import {
  clipboardActions,
  cookieActions,
  dialogActions,
  diffKinds,
  findKinds,
  getKinds,
  isKinds,
  logActions,
  networkActions,
  screenshotFormats,
  scrollDirections,
  storageActions,
  storageAreas,
} from "@firefox-cli/protocol";
import { isOneOf } from "../parse.js";

export function isGetKind(value: string | undefined): value is "text" | "html" | "value" | "attr" | "title" | "url" | "count" | "box" | "styles" {
  return isOneOf(getKinds, value);
}

export function isIsKind(value: string | undefined): value is "visible" | "enabled" | "checked" {
  return isOneOf(isKinds, value);
}

export function isElementActionCommand(value: string | undefined): value is "click" | "dblclick" | "focus" | "hover" | "check" | "uncheck" | "scrollintoview" {
  return (
    value === "click" ||
    value === "dblclick" ||
    value === "focus" ||
    value === "hover" ||
    value === "check" ||
    value === "uncheck" ||
    value === "scrollintoview"
  );
}

export function isScrollDirection(value: string | undefined): value is "up" | "down" | "left" | "right" {
  return isOneOf(scrollDirections, value);
}

export function isFindKind(value: string | undefined): value is "role" | "text" | "label" | "placeholder" | "alt" | "title" | "testid" {
  return isOneOf(findKinds, value);
}

export function isScreenshotFormat(value: string | undefined): value is (typeof screenshotFormats)[number] {
  return isOneOf(screenshotFormats, value);
}

export function isDialogAction(value: string | undefined): value is (typeof dialogActions)[number] {
  return isOneOf(dialogActions, value);
}

export function isClipboardAction(value: string | undefined): value is (typeof clipboardActions)[number] {
  return isOneOf(clipboardActions, value);
}

export function isCookieAction(value: string | undefined): value is (typeof cookieActions)[number] {
  return isOneOf(cookieActions, value);
}

export function isStorageArea(value: string | undefined): value is (typeof storageAreas)[number] {
  return isOneOf(storageAreas, value);
}

export function isStorageAction(value: string | undefined): value is (typeof storageActions)[number] {
  return isOneOf(storageActions, value);
}

export function isNetworkAction(value: string | undefined): value is (typeof networkActions)[number] {
  return isOneOf(networkActions, value);
}

export function isLogAction(value: string | undefined): value is (typeof logActions)[number] {
  return isOneOf(logActions, value);
}

export function isDiffKind(value: string | undefined): value is (typeof diffKinds)[number] {
  return isOneOf(diffKinds, value);
}
