import { startContentScriptRuntime, createContentMessageHandler } from "./content-runtime.js";

if (typeof browser !== "undefined") {
  startContentScriptRuntime({ browserRuntime: browser.runtime, document });
}

export { createContentMessageHandler };
