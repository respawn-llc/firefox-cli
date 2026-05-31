import { createRequest, MAX_UPLOAD_FILE_BYTES } from "@firefox-cli/protocol";
import { JSDOM } from "jsdom";
import { expect } from "vitest";
import { handleContentScriptRequest } from "./content-actions-test-support.js";
import { createSnapshotResult, ElementRefRegistry } from "./content-snapshot.js";

export function runCase01() {
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
}

export function runCase02() {
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

  const response = handleContentScriptRequest(createRequest("fill", { selector: "#email", text: "user@example.test" }, "fill-1"), {
    document: window.document,
    registry: new ElementRefRegistry<Element>(),
    now: 1000,
  });

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
    handleContentScriptRequest(createRequest("fill", { selector: "#disabled", text: "nope" }, "fill-2"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).toMatchObject({ ok: false, error: { code: "ELEMENT_DISABLED" } });
  expect(
    handleContentScriptRequest(createRequest("fill", { selector: "#button", text: "nope" }, "fill-3"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).toMatchObject({ ok: false, error: { code: "NOT_EDITABLE" } });
}

export function runCase03() {
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
    handleContentScriptRequest(createRequest("type", { selector: "#name", text: "ita" }, "type-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).toMatchObject({ ok: true, result: { action: "type", valueLength: 3 } });
  expect(name.value).toBe("Nikita");

  notes.focus();
  expect(
    handleContentScriptRequest(createRequest("keyboard.type", { text: "Ship it" }, "keyboard-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).toMatchObject({ ok: true, result: { action: "keyboard.type", valueLength: 7 } });
  expect(notes.value).toBe("Ship it");
}

export function runCase04() {
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
}

export function runCase05() {
  const { window } = new JSDOM(`<input id="agree" type="checkbox"><div id="aria" role="checkbox" aria-checked="false"></div><button id="bad">Bad</button>`, {
    url: "https://example.test/",
  });
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
}

export function runCase06() {
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
    handleContentScriptRequest(createRequest("select", { selector: "#plan", values: ["pro", "team"] }, "select-1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).toMatchObject({
    ok: true,
    result: {
      action: "select",
      selectedValues: ["pro", "team"],
    },
  });
  expect(Array.from(plan.selectedOptions).map((option) => option.value)).toEqual(["pro", "team"]);

  expect(
    handleContentScriptRequest(createRequest("select", { selector: "#plan", values: ["enterprise"] }, "select-2"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
  ).toMatchObject({ ok: false, error: { code: "OPTION_NOT_FOUND" } });
}

export async function runCase07() {
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
    handleContentScriptRequest(createRequest("scroll", { selector: "#feed", direction: "down", distancePx: 80 }, "s1"), {
      document: window.document,
      registry: new ElementRefRegistry<Element>(),
      now: 1000,
    }),
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
  const snapshot = createSnapshotResult(window.document, { interactiveOnly: true }, registry, 1000);
  save.remove();
  const stale = await handleContentScriptRequest(createRequest("click", { ref: "@e1", generationId: snapshot.generationId }, "click-ref-1"), {
    document: window.document,
    registry,
    now: 1001,
  });
  expect(stale).toMatchObject({ ok: false, error: { code: "REF_NOT_FOUND" } });
}
