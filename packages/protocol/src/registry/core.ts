import {
  capabilitiesParamsSchema,
  capabilitiesResultSchema,
  helloParamsSchema,
  helloResultSchema,
  noOpParamsSchema,
  noOpResultSchema,
} from "../core.js";
import { defineCommandEntries } from "./define.js";

export const coreCommandEntries = defineCommandEntries({
  hello: {
    params: helloParamsSchema,
    result: helloResultSchema,
    status: "mvp",
    owner: "native-host",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
  capabilities: {
    params: capabilitiesParamsSchema,
    result: capabilitiesResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [{ id: "capabilities", path: ["capabilities"], batch: false }],
  },
  noop: {
    params: noOpParamsSchema,
    result: noOpResultSchema,
    status: "mvp",
    owner: "extension",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
});
