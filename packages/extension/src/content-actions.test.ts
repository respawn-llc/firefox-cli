import { MAX_UPLOAD_FILE_BYTES, createRequest, type ResponseEnvelope } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import type { ActionOptions, ActionErrorCode } from "./content-action-types.js";
import { createActionResult } from "./content-actions.js";
import {
  ElementRefRegistry,
  createSnapshotResult,
  handleContentScriptRequest as handleRawContentScriptRequest,
} from "./content-snapshot.js";
import {
  createContentLogCaptureService,
  type ContentLogCaptureService,
} from "./content-snapshot/log-capture.js";

type TestContentOptions = Omit<
  Parameters<typeof handleRawContentScriptRequest>[1],
  "logCapture"
> & {
  readonly logCapture?: ContentLogCaptureService;
};

function handleContentScriptRequest(
  request: Parameters<typeof handleRawContentScriptRequest>[0],
  options: TestContentOptions,
) {
  return handleRawContentScriptRequest(request, {
    logCapture: createContentLogCaptureService(),
    ...options,
  });
}

class TestActionError extends Error {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
  ) {
    super(message);
  }
}

describe("content actions", () => {
  it("clicks visible enabled elements and returns an element summary", () => {
    const { window } = new JSDOM(`<button id="save">Save</button>`, {
      url: "https://example.test/",
    });
    let clicked = 0;
    window.document.querySelector("#save")?.addEventListener("click", () => {
      clicked += 1;
    });

    const response = handleContentScriptRequest(
      createRequest("click", { selector: "#save" }, "click-1"),
      { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
    );

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
  });

  it("throws a controlled error for forged action commands that bypass type checks", () => {
    const { window } = new JSDOM(`<button id="save">Save</button>`, {
      url: "https://example.test/",
    });
    const options = {
      document: window.document,
      command: "future.action",
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
    } as unknown as ActionOptions;

    try {
      createActionResult(options);
      throw new Error("expected forged action command to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TestActionError);
      expect((error as TestActionError).code).toBe("ACTION_REJECTED");
      expect((error as TestActionError).message).toContain("future.action");
    }
  });

  it("handles dblclick, hover, focus, keyboard inserttext, and swipe interactions", () => {
    const { window } = new JSDOM(
      `<button id="save">Save</button><input id="name"><div id="feed"></div>`,
      {
        url: "https://example.test/",
        pretendToBeVisual: true,
      },
    );
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
    expect(
      handleContentScriptRequest(createRequest("dblclick", { selector: "#save" }, "a1"), base),
    ).toMatchObject({ ok: true, result: { action: "dblclick" } });
    expect(
      handleContentScriptRequest(createRequest("hover", { selector: "#save" }, "a2"), base),
    ).toMatchObject({ ok: true, result: { action: "hover" } });
    expect(
      handleContentScriptRequest(createRequest("focus", { selector: "#name" }, "a3"), base),
    ).toMatchObject({ ok: true, result: { action: "focus" } });
    expect(
      handleContentScriptRequest(
        createRequest("keyboard.inserttext", { text: "Nikita" }, "a4"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "keyboard.inserttext", valueLength: 6 } });
    expect(
      handleContentScriptRequest(
        createRequest("swipe", { selector: "#feed", direction: "right", distancePx: 25 }, "a5"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "swipe", scroll: { x: 25, y: 0 } } });

    expect(doubleClicked).toBe(1);
    expect(hoverEvents).toBe(1);
    expect(focused).toBe(1);
    expect(name.value).toBe("Nikita");
    expect(keyEvents).toBe(0);
    expect(feed.scrollLeft).toBe(25);
  });

  it("drags between elements, uploads files, and dispatches direct pointer/key events", () => {
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
      events.push(`dragstart:${"dataTransfer" in event}`);
    });
    drop.addEventListener("drop", (event) => {
      events.push(`drop:${"dataTransfer" in event}`);
    });
    drop.addEventListener("mousedown", (event) => {
      const mouse = event as MouseEvent;
      events.push(`down:${mouse.clientX}:${mouse.button}`);
    });
    drop.addEventListener("wheel", (event) => {
      const wheel = event as WheelEvent;
      events.push(`wheel:${wheel.deltaY}`);
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

    expect(
      handleContentScriptRequest(
        createRequest("drag", { sourceSelector: "#source", targetSelector: "#drop" }, "drag-1"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "drag", element: { text: "Drop target" } } });
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
    expect(
      handleContentScriptRequest(
        createRequest(
          "mouse",
          { action: "down", selector: "#drop", x: 12, y: 34, button: 1 },
          "m1",
        ),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "mouse" } });
    expect(
      handleContentScriptRequest(
        createRequest("mouse", { action: "wheel", selector: "#drop", deltaY: 120 }, "m2"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "mouse" } });
    expect(
      handleContentScriptRequest(
        createRequest("keydown", { key: "A", selector: "#keys" }, "key-1"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "keydown" } });
    expect(
      handleContentScriptRequest(
        createRequest("keyup", { key: "A", selector: "#keys" }, "key-2"),
        base,
      ),
    ).toMatchObject({ ok: true, result: { action: "keyup" } });

    expect(file.files?.item(0)?.name).toBe("fixture.txt");
    expect(events).toEqual([
      "dragstart:true",
      "drop:true",
      "upload-change",
      "down:12:1",
      "wheel:120",
      "keydown:A",
      "keyup:A",
    ]);
  });

  it("keeps drag and upload shims local to events and file inputs", () => {
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
    const originalDataTransfer = window.DataTransfer;
    const originalFileList = window.FileList;
    const originalEventDataTransfer = Object.getOwnPropertyDescriptor(
      window.Event.prototype,
      "dataTransfer",
    );
    const originalInputFiles = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "files",
    );
    let dragStartEvent: Event | undefined;
    source.addEventListener("dragstart", (event) => {
      dragStartEvent = event;
    });
    const base = {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    };

    handleContentScriptRequest(
      createRequest("drag", { sourceSelector: "#source", targetSelector: "#drop" }, "drag-shim"),
      base,
    );
    expect(dragStartEvent).toBeDefined();
    expect("dataTransfer" in (dragStartEvent as Event)).toBe(true);
    if (typeof window.DragEvent !== "function") {
      expect(Object.hasOwn(dragStartEvent as Event, "dataTransfer")).toBe(true);
    }
    expect(Object.getOwnPropertyDescriptor(window.Event.prototype, "dataTransfer")).toEqual(
      originalEventDataTransfer,
    );

    for (const [id, name, text] of [
      ["upload-shim-1", "first.txt", "first"],
      ["upload-shim-2", "second.txt", "second"],
    ] as const) {
      handleContentScriptRequest(
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
    expect(Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "files")).toEqual(
      originalInputFiles,
    );
    const ownFiles = Object.getOwnPropertyDescriptor(file, "files");
    if (ownFiles !== undefined) {
      expect(ownFiles.configurable).toBe(true);
      expect((ownFiles.value as FileList).item(0)?.name).toBe("second.txt");
    }
  });

  it("rejects oversized uploads before assigning files or dispatching change", () => {
    const { window } = new JSDOM(`<input id="file" type="file">`, {
      url: "https://example.test/",
    });
    const file = window.document.querySelector<HTMLInputElement>("#file");
    if (file === null) {
      throw new Error("fixture missing file input");
    }
    let changes = 0;
    file.addEventListener("change", () => {
      changes += 1;
    });

    const response = handleContentScriptRequest(
      createRequest(
        "upload",
        {
          selector: "#file",
          files: [
            {
              name: "big.bin",
              dataBase64: Buffer.alloc(MAX_UPLOAD_FILE_BYTES + 1).toString("base64"),
            },
          ],
        },
        "upload-too-large",
      ),
      { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
    );

    expect(response).toMatchObject({
      ok: false,
      error: { code: "OUTPUT_TOO_LARGE" },
    });
    expect(file.files).toHaveLength(0);
    expect(changes).toBe(0);
  });

  it("fills editable controls and rejects disabled or non-editable elements", () => {
    const { window } = new JSDOM(
      `<main>
        <input id="email">
        <input id="disabled" disabled>
        <button id="button">Save</button>
      </main>`,
      { url: "https://example.test/" },
    );
    const email = window.document.querySelector<HTMLInputElement>("#email");
    if (email === null) {
      throw new Error("fixture missing email");
    }
    const events: string[] = [];
    email.addEventListener("input", () => events.push("input"));
    email.addEventListener("change", () => events.push("change"));

    const response = handleContentScriptRequest(
      createRequest("fill", { selector: "#email", text: "user@example.test" }, "fill-1"),
      { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
    );

    expect(email.value).toBe("user@example.test");
    expect(events).toEqual(["input", "change"]);
    expect(response).toMatchObject({
      ok: true,
      result: {
        action: "fill",
        valueLength: 17,
        element: {
          value: "user@example.test",
        },
      },
    });
    expect(
      handleContentScriptRequest(
        createRequest("fill", { selector: "#disabled", text: "nope" }, "fill-2"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({ ok: false, error: { code: "ELEMENT_DISABLED" } });
    expect(
      handleContentScriptRequest(
        createRequest("fill", { selector: "#button", text: "nope" }, "fill-3"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_EDITABLE" } });
  });

  it("types into targeted and focused editable elements", () => {
    const { window } = new JSDOM(`<input id="name" value="Nik"><textarea id="notes"></textarea>`, {
      url: "https://example.test/",
      pretendToBeVisual: true,
    });
    const name = window.document.querySelector<HTMLInputElement>("#name");
    const notes = window.document.querySelector<HTMLTextAreaElement>("#notes");
    if (name === null || notes === null) {
      throw new Error("fixture missing editable elements");
    }
    name.setSelectionRange(3, 3);

    expect(
      handleContentScriptRequest(
        createRequest("type", { selector: "#name", text: "ita" }, "type-1"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({ ok: true, result: { action: "type", valueLength: 3 } });
    expect(name.value).toBe("Nikita");

    notes.focus();
    expect(
      handleContentScriptRequest(
        createRequest("keyboard.type", { text: "Ship it" }, "keyboard-1"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({ ok: true, result: { action: "keyboard.type", valueLength: 7 } });
    expect(notes.value).toBe("Ship it");
  });

  it("presses keys on the focused element and rejects missing focus", () => {
    const { window } = new JSDOM(`<input id="name">`, {
      url: "https://example.test/",
      pretendToBeVisual: true,
    });
    const name = window.document.querySelector<HTMLInputElement>("#name");
    if (name === null) {
      throw new Error("fixture missing input");
    }
    const events: string[] = [];
    name.addEventListener("keydown", (event) => events.push(`down:${event.key}`));
    name.addEventListener("keyup", (event) => events.push(`up:${event.key}`));
    name.focus();

    expect(
      handleContentScriptRequest(createRequest("press", { key: "Enter" }, "press-1"), {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      }),
    ).toMatchObject({ ok: true, result: { action: "press" } });
    expect(events).toEqual(["down:Enter", "up:Enter"]);

    const unfocused = new JSDOM(`<main></main>`, { url: "https://example.test/" });
    expect(
      handleContentScriptRequest(createRequest("press", { key: "Enter" }, "press-2"), {
        document: unfocused.window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      }),
    ).toMatchObject({ ok: false, error: { code: "NO_FOCUSED_ELEMENT" } });
  });

  it("checks and unchecks checkable elements", () => {
    const { window } = new JSDOM(
      `<input id="agree" type="checkbox"><div id="aria" role="checkbox" aria-checked="false"></div><button id="bad">Bad</button>`,
      { url: "https://example.test/" },
    );
    const agree = window.document.querySelector<HTMLInputElement>("#agree");
    const aria = window.document.querySelector("#aria");
    if (agree === null || aria === null) {
      throw new Error("fixture missing checkable elements");
    }

    expect(
      handleContentScriptRequest(createRequest("check", { selector: "#agree" }, "check-1"), {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      }),
    ).toMatchObject({ ok: true, result: { action: "check" } });
    expect(agree.checked).toBe(true);

    expect(
      handleContentScriptRequest(createRequest("uncheck", { selector: "#aria" }, "uncheck-1"), {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      }),
    ).toMatchObject({ ok: true, result: { action: "uncheck" } });
    expect(aria.getAttribute("aria-checked")).toBe("false");

    expect(
      handleContentScriptRequest(createRequest("check", { selector: "#bad" }, "check-2"), {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      }),
    ).toMatchObject({ ok: false, error: { code: "ACTION_REJECTED" } });
  });

  it("selects options and reports missing values", () => {
    const { window } = new JSDOM(
      `<select id="plan" multiple>
        <option value="free">Free</option>
        <option value="pro">Pro</option>
        <option value="team">Team</option>
      </select>`,
      { url: "https://example.test/" },
    );
    const plan = window.document.querySelector<HTMLSelectElement>("#plan");
    if (plan === null) {
      throw new Error("fixture missing select");
    }

    expect(
      handleContentScriptRequest(
        createRequest("select", { selector: "#plan", values: ["pro", "team"] }, "select-1"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({
      ok: true,
      result: {
        action: "select",
        selectedValues: ["pro", "team"],
      },
    });
    expect(Array.from(plan.selectedOptions).map((option) => option.value)).toEqual(["pro", "team"]);

    expect(
      handleContentScriptRequest(
        createRequest("select", { selector: "#plan", values: ["enterprise"] }, "select-2"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({ ok: false, error: { code: "OPTION_NOT_FOUND" } });
  });

  it("scrolls elements, scrolls elements into view, and keeps stale refs as REF_NOT_FOUND", () => {
    const { window } = new JSDOM(`<div id="feed"></div><button id="save">Save</button>`, {
      url: "https://example.test/",
    });
    const feed = window.document.querySelector<HTMLElement>("#feed");
    const save = window.document.querySelector<HTMLElement>("#save");
    if (feed === null || save === null) {
      throw new Error("fixture missing scroll elements");
    }
    let scrolledIntoView = false;
    save.scrollIntoView = () => {
      scrolledIntoView = true;
    };

    expect(
      handleContentScriptRequest(
        createRequest("scroll", { selector: "#feed", direction: "down", distancePx: 80 }, "s1"),
        { document: window.document, registry: new ElementRefRegistry<Element>(), now: 1000 },
      ),
    ).toMatchObject({ ok: true, result: { action: "scroll", scroll: { x: 0, y: 80 } } });
    expect(feed.scrollTop).toBe(80);

    expect(
      handleContentScriptRequest(createRequest("scrollintoview", { selector: "#save" }, "s2"), {
        document: window.document,
        registry: new ElementRefRegistry<Element>(),
        now: 1000,
      }),
    ).toMatchObject({ ok: true, result: { action: "scrollintoview" } });
    expect(scrolledIntoView).toBe(true);

    const registry = new ElementRefRegistry<Element>();
    const snapshot = createSnapshotResult(
      window.document,
      { interactiveOnly: true },
      registry,
      1000,
    );
    save.remove();
    const stale = handleContentScriptRequest(
      createRequest("click", { ref: "@e1", generationId: snapshot.generationId }, "click-ref-1"),
      { document: window.document, registry, now: 1001 },
    ) as ResponseEnvelope<"click">;
    expect(stale).toMatchObject({ ok: false, error: { code: "REF_NOT_FOUND" } });
  });
});
