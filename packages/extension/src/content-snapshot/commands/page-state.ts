import type { ClipboardResult, DialogResult, StorageResult } from "@firefox-cli/protocol";
import type { ElementRefRegistry } from "../../element-ref-registry.js";
import { getElementText, setElementText } from "../accessibility.js";
import { resolveElement } from "../dom.js";
import { ContentSnapshotError } from "../errors.js";

export function createDialogResult(action: DialogResult["action"]): DialogResult {
  return {
    action,
    handled: false,
  };
}

export function createClipboardResult(
  document: Document,
  action: ClipboardResult["action"],
  params: {
    readonly selector?: string;
    readonly ref?: string;
    readonly generationId?: string;
    readonly text?: string;
  },
  registry: ElementRefRegistry<Element>,
  now = Date.now(),
): ClipboardResult {
  if (action === "copy") {
    const element = resolveElement(document, params, registry, now);
    return {
      action,
      ok: true,
      text: getElementText(element),
    };
  }
  if (action === "paste") {
    const element = resolveElement(document, params, registry, now);
    setElementText(element, params.text ?? "");
    return { action, ok: true };
  }
  return { action, ok: true, ...(params.text === undefined ? {} : { text: params.text }) };
}

export function createStorageResult(
  document: Document,
  params: {
    readonly area: "local" | "session";
    readonly action: "get" | "set" | "remove" | "clear";
    readonly key?: string;
    readonly value?: string;
  },
): StorageResult {
  const storage =
    params.area === "local" ? document.defaultView?.localStorage : document.defaultView?.sessionStorage;
  if (storage === undefined) {
    throw new ContentSnapshotError("ACTION_REJECTED", "Storage is unavailable.");
  }
  if (params.action === "set") {
    if (params.key === undefined) {
      throw new ContentSnapshotError("ACTION_REJECTED", "Storage set requires a key.");
    }
    storage.setItem(params.key, params.value ?? "");
    return { area: params.area, action: params.action, ok: true };
  }
  if (params.action === "remove") {
    if (params.key === undefined) {
      throw new ContentSnapshotError("ACTION_REJECTED", "Storage remove requires a key.");
    }
    storage.removeItem(params.key);
    return { area: params.area, action: params.action, ok: true };
  }
  if (params.action === "clear") {
    storage.clear();
    return { area: params.area, action: params.action, ok: true };
  }
  if (params.key !== undefined) {
    return {
      area: params.area,
      action: params.action,
      ok: true,
      value: storage.getItem(params.key),
    };
  }
  return {
    area: params.area,
    action: params.action,
    ok: true,
    entries: Object.fromEntries(
      Array.from({ length: storage.length }, (_, index) => {
        const key = storage.key(index) ?? "";
        return [key, storage.getItem(key) ?? ""];
      }),
    ),
  };
}
