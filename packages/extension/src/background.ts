import { startBackground } from "./background-bootstrap.js";
import manifest from "./manifest.json" with { type: "json" };

startBackground({ browser, manifest });
