import { describe, it } from "vitest";
import { runCase01, runCase02, runCase03, runCase04, runCase05 } from "./content-actions-test-cases.js";

describe("content actions", () => {
  it("clicks visible enabled elements and returns an element summary", runCase01);
  it("throws a controlled error for forged action commands that bypass type checks", runCase02);
  it("handles dblclick, hover, focus, keyboard inserttext, and swipe interactions", runCase03);
  it("drags between elements, uploads files, and dispatches direct pointer/key events", runCase04);
  it("keeps drag and upload shims local to events and file inputs", runCase05);
});
