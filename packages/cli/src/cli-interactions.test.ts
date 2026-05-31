import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";
import { actionElement, baseDependencies } from "./cli-test-support.js";

describe("runCli interactions", () => {
  it("runs text, keyboard, selection, and scroll interactions", async () => {
    const cases: readonly {
      readonly args: readonly string[];
      readonly command: string;
      readonly params: Record<string, unknown>;
      readonly result: Record<string, unknown>;
      readonly stdout: string;
    }[] = [
      {
        args: ["fill", "#email", "user@example.test"],
        command: "fill",
        params: { selector: "#email", text: "user@example.test" },
        result: {
          action: "fill",
          ok: true,
          element: actionElement("textbox", "Email"),
          valueLength: 17,
        },
        stdout: "fill ok textbox Email valueLength=17\n",
      },
      {
        args: ["fill", "#token", "--abc"],
        command: "fill",
        params: { selector: "#token", text: "--abc" },
        result: {
          action: "fill",
          ok: true,
          element: actionElement("textbox", "Token"),
          valueLength: 5,
        },
        stdout: "fill ok textbox Token valueLength=5\n",
      },
      {
        args: ["fill", "#token", "--window"],
        command: "fill",
        params: { selector: "#token", text: "--window" },
        result: {
          action: "fill",
          ok: true,
          element: actionElement("textbox", "Token"),
          valueLength: 8,
        },
        stdout: "fill ok textbox Token valueLength=8\n",
      },
      {
        args: ["type", "#name", "Nikita"],
        command: "type",
        params: { selector: "#name", text: "Nikita" },
        result: {
          action: "type",
          ok: true,
          element: actionElement("textbox", "Name"),
          valueLength: 6,
        },
        stdout: "type ok textbox Name valueLength=6\n",
      },
      {
        args: ["keyboard", "type", "hello"],
        command: "keyboard.type",
        params: { text: "hello" },
        result: {
          action: "keyboard.type",
          ok: true,
          element: actionElement("textbox", "Active"),
          valueLength: 5,
        },
        stdout: "keyboard.type ok textbox Active valueLength=5\n",
      },
      {
        args: ["keyboard", "type", "--abc"],
        command: "keyboard.type",
        params: { text: "--abc" },
        result: {
          action: "keyboard.type",
          ok: true,
          element: actionElement("textbox", "Active"),
          valueLength: 5,
        },
        stdout: "keyboard.type ok textbox Active valueLength=5\n",
      },
      {
        args: ["keyboard", "type", "--tab"],
        command: "keyboard.type",
        params: { text: "--tab" },
        result: {
          action: "keyboard.type",
          ok: true,
          element: actionElement("textbox", "Active"),
          valueLength: 5,
        },
        stdout: "keyboard.type ok textbox Active valueLength=5\n",
      },
      {
        args: ["press", "Enter"],
        command: "press",
        params: { key: "Enter" },
        result: { action: "press", ok: true, element: actionElement("button", "Save") },
        stdout: "press ok button Save\n",
      },
      {
        args: ["select", "select", "pro", "team"],
        command: "select",
        params: { selector: "select", values: ["pro", "team"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["pro", "team"],
        },
        stdout: "select ok combobox Plan selected=pro,team\n",
      },
      {
        args: ["select", "select", "--pro"],
        command: "select",
        params: { selector: "select", values: ["--pro"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["--pro"],
        },
        stdout: "select ok combobox Plan selected=--pro\n",
      },
      {
        args: ["select", "select", "--generation"],
        command: "select",
        params: { selector: "select", values: ["--generation"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["--generation"],
        },
        stdout: "select ok combobox Plan selected=--generation\n",
      },
      {
        args: ["select", "select", "pro", "--generation"],
        command: "select",
        params: { selector: "select", values: ["pro", "--generation"] },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["pro", "--generation"],
        },
        stdout: "select ok combobox Plan selected=pro,--generation\n",
      },
      {
        args: ["select", "#plan", "pro", "--tab", "id:42", "--json"],
        command: "select",
        params: { selector: "#plan", values: ["pro"], target: { tab: { kind: "id", id: 42 } } },
        result: {
          action: "select",
          ok: true,
          element: actionElement("combobox", "Plan"),
          selectedValues: ["pro"],
        },
        stdout: `${JSON.stringify(
          {
            ok: true,
            action: "select",
            element: actionElement("combobox", "Plan"),
            selectedValues: ["pro"],
          },
          null,
          2,
        )}\n`,
      },
      {
        args: ["scroll", "down", "300", "#feed"],
        command: "scroll",
        params: { direction: "down", distancePx: 300, selector: "#feed" },
        result: { action: "scroll", ok: true, scroll: { x: 0, y: 300 } },
        stdout: "scroll ok scroll=0,300\n",
      },
    ];

    for (const testCase of cases) {
      const output = await runCli(testCase.args, {
        ...baseDependencies(),
        sendRequest: async (request) => {
          expect(request).toMatchObject({
            command: testCase.command,
            params: testCase.params,
          });
          return {
            protocolVersion: request.protocolVersion,
            id: request.id,
            ok: true,
            result: testCase.result,
          };
        },
      });

      expect(output).toEqual({
        exitCode: 0,
        stdout: testCase.stdout,
        stderr: "",
      });
    }
  });
});
