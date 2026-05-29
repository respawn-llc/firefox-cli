import { installLogCapture } from "./content-snapshot/log-capture.js";

installLogCapture();

export { ElementRefRegistry } from "./element-ref-registry.js";
export { ContentSnapshotError } from "./content-snapshot/errors.js";
export { handleContentScriptRequest } from "./content-snapshot/router.js";
export { createSnapshotResult } from "./content-snapshot/snapshot-render.js";
