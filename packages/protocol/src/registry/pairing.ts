import { pairApproveParamsSchema, pairApproveResultSchema, pairResetParamsSchema, pairResetResultSchema } from "../pairing.js";
import { defineCommandEntries } from "./define.js";

export const pairingCommandEntries = defineCommandEntries({
  "pair.approve": {
    params: pairApproveParamsSchema,
    result: pairApproveResultSchema,
    status: "mvp",
    owner: "native-host",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
  "pair.reset": {
    params: pairResetParamsSchema,
    result: pairResetResultSchema,
    status: "mvp",
    owner: "native-host",
    target: "none",
    content: "never",
    action: false,
    timeout: "none",
    batch: { allowed: false },
    cliRoutes: [],
  },
});
