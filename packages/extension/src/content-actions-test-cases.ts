import { createRequest } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import type { ActionErrorCode, ActionOptions } from "./content-action-types.js";
import { createActionResult } from "./content-actions.js";
import { handleContentScriptRequest, TestActionError } from "./content-actions-test-support.js";
import { ElementRefRegistry } from "./content-snapshot.js";

export function runCase01() {
  const { window } = new JSDOM(`<button id="save">Save</button>`, {
    url: "https://example.test/",
  });
  let clicked = 0;
  window.document.querySelector("#save")?.addEventListener("click", () => {
    clicked += 1;
  });

  const response = handleContentScriptRequest(createRequest("click", { selector: "#save" }, "click-1"), {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  });

  expect(clicked).toBe(1);
  expect(response).toMatchObject({
    ok: true,
    result: {
      action: "click",
      ok: true,
      element: {
        tagName: "button",
        role: "button",
        name: "Save",
        visible: true,
      },
    },
  });
}

export function runCase02() {
  const { window } = new JSDOM(`<button id="save">Save</button>`, {
    url: "https://example.test/",
  });
  const options = {
    document: window.document,
    command: "click",
    params: {},
    now: 1000,
    resolveRef: () => {
      throw new Error("unexpected ref resolution");
    },
    queryElement: () => null,
    summarizeElement: () => {
      throw new Error("unexpected summary");
    },
    isVisible: () => true,
    isDisabled: () => false,
    createError: (code: ActionErrorCode, message: string) => new TestActionError(code, message),
  } satisfies ActionOptions;
  Object.defineProperty(options, "command", { value: "future.action" });

  try {
    createActionResult(options);
    throw new Error("expected forged action command to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(TestActionError);
    if (!(error instanceof TestActionError)) {
      throw error;
    }
    expect(error.code).toBe("ACTION_REJECTED");
    expect(error.message).toContain("future.action");
  }
}

export function runCase03() {
  const { window } = new JSDOM(`<button id="save">Save</button><input id="name"><div id="feed"></div>`, {
    url: "https://example.test/",
    pretendToBeVisual: true,
  });
  const save = window.document.querySelector<HTMLButtonElement>("#save");
  const name = window.document.querySelector<HTMLInputElement>("#name");
  const feed = window.document.querySelector<HTMLElement>("#feed");
  if (save === null || name === null || feed === null) {
    throw new Error("fixture missing interaction elements");
  }
  let doubleClicked = 0;
  let hoverEvents = 0;
  let focused = 0;
  let keyEvents = 0;
  save.addEventListener("dblclick", () => {
    doubleClicked += 1;
  });
  save.addEventListener("mouseover", () => {
    hoverEvents += 1;
  });
  name.addEventListener("focus", () => {
    focused += 1;
  });
  name.addEventListener("keydown", () => {
    keyEvents += 1;
  });

  const registry = new ElementRefRegistry<Element>();
  const base = { document: window.document, registry, now: 1000 };
  expect(handleContentScriptRequest(createRequest("dblclick", { selector: "#save" }, "a1"), base)).toMatchObject({ ok: true, result: { action: "dblclick" } });
  expect(handleContentScriptRequest(createRequest("hover", { selector: "#save" }, "a2"), base)).toMatchObject({ ok: true, result: { action: "hover" } });
  expect(handleContentScriptRequest(createRequest("focus", { selector: "#name" }, "a3"), base)).toMatchObject({ ok: true, result: { action: "focus" } });
  expect(handleContentScriptRequest(createRequest("keyboard.inserttext", { text: "Nikita" }, "a4"), base)).toMatchObject({
    ok: true,
    result: { action: "keyboard.inserttext", valueLength: 6 },
  });
  expect(handleContentScriptRequest(createRequest("swipe", { selector: "#feed", direction: "right", distancePx: 25 }, "a5"), base)).toMatchObject({
    ok: true,
    result: { action: "swipe", scroll: { x: 25, y: 0 } },
  });

  expect(doubleClicked).toBe(1);
  expect(hoverEvents).toBe(1);
  expect(focused).toBe(1);
  expect(name.value).toBe("Nikita");
  expect(keyEvents).toBe(0);
  expect(feed.scrollLeft).toBe(25);
}

export function runCase04() {
  const { window } = new JSDOM(
    `<main>
        <button id="source">Card</button>
        <div id="drop">Drop target</div>
        <input id="file" type="file">
        <input id="keys">
      </main>`,
    {
      url: "https://example.test/",
      pretendToBeVisual: true,
    },
  );
  const source = window.document.querySelector("#source");
  const drop = window.document.querySelector("#drop");
  const file = window.document.querySelector<HTMLInputElement>("#file");
  const keys = window.document.querySelector<HTMLInputElement>("#keys");
  if (source === null || drop === null || file === null || keys === null) {
    throw new Error("fixture missing Phase 8 action elements");
  }

  const events: string[] = [];
  source.addEventListener("dragstart", (event) => {
    events.push(`dragstart:${String("dataTransfer" in event)}`);
  });
  drop.addEventListener("drop", (event) => {
    events.push(`drop:${String("dataTransfer" in event)}`);
  });
  drop.addEventListener("mousedown", (event) => {
    if (!(event instanceof window.MouseEvent)) {
      throw new Error("Expected mousedown to receive a MouseEvent.");
    }
    events.push(`down:${String(event.clientX)}:${String(event.button)}`);
  });
  drop.addEventListener("wheel", (event) => {
    if (!(event instanceof window.WheelEvent)) {
      throw new Error("Expected wheel to receive a WheelEvent.");
    }
    events.push(`wheel:${String(event.deltaY)}`);
  });
  file.addEventListener("change", () => {
    events.push("upload-change");
  });
  keys.addEventListener("keydown", (event) => {
    events.push(`keydown:${event.key}`);
  });
  keys.addEventListener("keyup", (event) => {
    events.push(`keyup:${event.key}`);
  });

  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  };

  expect(handleContentScriptRequest(createRequest("drag", { sourceSelector: "#source", targetSelector: "#drop" }, "drag-1"), base)).toMatchObject({
    ok: true,
    result: { action: "drag", element: { text: "Drop target" } },
  });
  expect(
    handleContentScriptRequest(
      createRequest(
        "upload",
        {
          selector: "#file",
          files: [
            {
              name: "fixture.txt",
              mimeType: "text/plain",
              dataBase64: window.btoa("hello"),
            },
          ],
        },
        "upload-1",
      ),
      base,
    ),
  ).toMatchObject({ ok: true, result: { action: "upload", valueLength: 1 } });
  expect(handleContentScriptRequest(createRequest("mouse", { action: "down", selector: "#drop", x: 12, y: 34, button: 1 }, "m1"), base)).toMatchObject({
    ok: true,
    result: { action: "mouse" },
  });
  expect(handleContentScriptRequest(createRequest("mouse", { action: "wheel", selector: "#drop", deltaY: 120 }, "m2"), base)).toMatchObject({
    ok: true,
    result: { action: "mouse" },
  });
  expect(handleContentScriptRequest(createRequest("keydown", { key: "A", selector: "#keys" }, "key-1"), base)).toMatchObject({
    ok: true,
    result: { action: "keydown" },
  });
  expect(handleContentScriptRequest(createRequest("keyup", { key: "A", selector: "#keys" }, "key-2"), base)).toMatchObject({
    ok: true,
    result: { action: "keyup" },
  });

  expect(file.files?.item(0)?.name).toBe("fixture.txt");
  expect(events).toEqual(["dragstart:true", "drop:true", "upload-change", "down:12:1", "wheel:120", "keydown:A", "keyup:A"]);
}

export async function runCase05() {
  const { window } = new JSDOM(
    `<main>
        <button id="source">Card</button>
        <div id="drop">Drop target</div>
        <input id="file" type="file">
      </main>`,
    {
      url: "https://example.test/",
      pretendToBeVisual: true,
    },
  );
  const source = window.document.querySelector("#source");
  const file = window.document.querySelector<HTMLInputElement>("#file");
  if (source === null || file === null) {
    throw new Error("fixture missing shim elements");
  }
  const originalDataTransfer: unknown = window.DataTransfer;
  const originalFileList: unknown = window.FileList;
  const originalEventDataTransfer = Object.getOwnPropertyDescriptor(window.Event.prototype, "dataTransfer");
  const originalInputFiles = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "files");
  let dragStartEvent: Event | undefined;
  source.addEventListener("dragstart", (event) => {
    dragStartEvent = event;
  });
  const base = {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  };

  await handleContentScriptRequest(createRequest("drag", { sourceSelector: "#source", targetSelector: "#drop" }, "drag-shim"), base);
  if (dragStartEvent === undefined) {
    throw new Error("Expected dragstart event to be dispatched.");
  }
  expect("dataTransfer" in dragStartEvent).toBe(true);
  if (typeof window.DragEvent !== "function") {
    expect(Object.hasOwn(dragStartEvent, "dataTransfer")).toBe(true);
  }
  expect(Object.getOwnPropertyDescriptor(window.Event.prototype, "dataTransfer")).toEqual(originalEventDataTransfer);

  for (const [id, name, text] of [
    ["upload-shim-1", "first.txt", "first"],
    ["upload-shim-2", "second.txt", "second"],
  ] as const) {
    await handleContentScriptRequest(
      createRequest(
        "upload",
        {
          selector: "#file",
          files: [{ name, dataBase64: window.btoa(text) }],
        },
        id,
      ),
      base,
    );
  }

  expect(file.files).toHaveLength(1);
  expect(file.files?.item(0)?.name).toBe("second.txt");
  expect(window.DataTransfer).toBe(originalDataTransfer);
  expect(window.FileList).toBe(originalFileList);
  expect(Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "files")).toEqual(originalInputFiles);
  const ownFiles = Object.getOwnPropertyDescriptor(file, "files");
  if (ownFiles !== undefined) {
    expect(ownFiles.configurable).toBe(true);
    if (!isFileListLike(ownFiles.value)) {
      throw new Error("Expected input files property to contain a FileList.");
    }
    expect(ownFiles.value.item(0)?.name).toBe("second.txt");
  }
}

function isFileListLike(value: unknown): value is FileList {
  return typeof value === "object" && value !== null && "item" in value;
}
