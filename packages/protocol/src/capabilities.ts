import type { CapabilitySummary } from "./core.js";
import { commandSchemas } from "./registry/index.js";

export type GatedCapabilitySummary = CapabilitySummary & {
  readonly cliCommands?: readonly string[];
};

export const gatedCapabilities: readonly GatedCapabilitySummary[] = [
  {
    command: "screenshot --full",
    status: "unsupported",
    reason: "full-page screenshots are unsupported because Firefox WebExtensions expose visible-tab capture only.",
  },
  {
    command: "close",
    status: "unsupported",
    reason: "top-level close is unsupported; use explicit tab close or window close.",
    cliCommands: ["close"],
  },
  {
    command: "quit",
    status: "unsupported",
    reason: "quit is unsupported because firefox-cli must not terminate the user's Firefox process.",
    cliCommands: ["quit"],
  },
  {
    command: "exit",
    status: "unsupported",
    reason: "exit is unsupported because firefox-cli must not terminate the user's Firefox process.",
    cliCommands: ["exit"],
  },
  {
    command: "inspect",
    status: "unsupported",
    reason: "inspect is unsupported because Firefox does not expose agent-browser CDP inspection.",
    cliCommands: ["inspect"],
  },
] as const;

export const kernelCapabilities: readonly CapabilitySummary[] = [
  ...Object.entries(commandSchemas).map(([command, schema]) => ({
    command,
    status: schema.status,
  })),
  ...gatedCapabilities.map(({ command, status, reason }) => ({ command, status, reason })),
];
