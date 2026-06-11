import { buildBinary } from "./build-binary.js";
import { supportedBinaryTargets } from "./platform-targets.js";

for (const target of supportedBinaryTargets) {
  await buildBinary(target);
}
