import { commandSchemas, getCommandSecurityMetadata, isCommandId, type CommandId } from "./registry/index.js";
import type { CommandPrivilegeReason, CommandSchemaEntry } from "./metadata.js";

export type FirefoxManifestPermission =
  | "nativeMessaging"
  | "scripting"
  | "tabs"
  | "storage"
  | "downloads"
  | "cookies"
  | "clipboardRead"
  | "clipboardWrite"
  | "webRequest";

export type FirefoxHostPermission = "<all_urls>";

export type FirefoxDataCollectionPermission =
  | "authenticationInfo"
  | "bookmarksInfo"
  | "browsingActivity"
  | "financialAndPaymentInfo"
  | "healthInfo"
  | "locationInfo"
  | "personalCommunications"
  | "personallyIdentifyingInfo"
  | "searchTerms"
  | "websiteActivity"
  | "websiteContent"
  | "technicalAndInteraction";

export interface ExtensionCommandRequirement {
  readonly command: CommandId;
  readonly securityReasons: readonly CommandPrivilegeReason[];
  readonly hostAccess: boolean;
  readonly manifestPermissions: readonly FirefoxManifestPermission[];
  readonly networkObservation: boolean;
}

export interface FirefoxDataCollectionRequirements {
  readonly required: readonly FirefoxDataCollectionPermission[];
  readonly optional: readonly FirefoxDataCollectionPermission[];
}

export interface ExtensionPermissionRequirements {
  readonly firefoxStrictMinVersion: string;
  readonly manifestPermissions: readonly FirefoxManifestPermission[];
  readonly hostPermissions: readonly FirefoxHostPermission[];
  readonly popupApprovalOrigins: readonly FirefoxHostPermission[];
  readonly webRequestListenerOrigins: readonly FirefoxHostPermission[];
  readonly dataCollection: FirefoxDataCollectionRequirements;
  readonly commands: readonly ExtensionCommandRequirement[];
}

const allUrlsOrigin: FirefoxHostPermission = "<all_urls>";

const baseManifestPermissions = ["nativeMessaging", "scripting", "tabs", "storage"] as const satisfies readonly FirefoxManifestPermission[];

const requiredDataCollectionPermissions = [
  "browsingActivity",
  "websiteActivity",
  "websiteContent",
] as const satisfies readonly FirefoxDataCollectionPermission[];

const privilegeManifestPermissions = {
  "page-mutation": [],
  "page-code-execution": [],
  "page-function-evaluation": [],
  clipboard: ["clipboardRead", "clipboardWrite"],
  downloads: ["downloads"],
  cookies: ["cookies"],
  "network-observation": ["webRequest"],
} as const satisfies Record<CommandPrivilegeReason, readonly FirefoxManifestPermission[]>;

const pageAccessReasons = new Set<CommandPrivilegeReason>([
  "page-mutation",
  "page-code-execution",
  "page-function-evaluation",
  "cookies",
  "network-observation",
]);

export function getExtensionPermissionRequirements(): ExtensionPermissionRequirements {
  const manifestPermissions = new Set<FirefoxManifestPermission>(baseManifestPermissions);
  const hostPermissions = new Set<FirefoxHostPermission>();
  const webRequestListenerOrigins = new Set<FirefoxHostPermission>();

  const commands = Object.entries(commandSchemas).map(([command, entry]) => {
    const requirement = deriveCommandRequirement(entry, getCommandId(command));
    for (const permission of requirement.manifestPermissions) {
      manifestPermissions.add(permission);
    }
    if (requirement.hostAccess) {
      hostPermissions.add(allUrlsOrigin);
    }
    if (requirement.networkObservation) {
      webRequestListenerOrigins.add(allUrlsOrigin);
    }
    return requirement;
  });

  const hostPermissionList = sorted(hostPermissions);
  return {
    firefoxStrictMinVersion: "150.0",
    manifestPermissions: sorted(manifestPermissions),
    hostPermissions: hostPermissionList,
    popupApprovalOrigins: hostPermissionList,
    webRequestListenerOrigins: sorted(webRequestListenerOrigins),
    dataCollection: {
      required: [...requiredDataCollectionPermissions],
      optional: [],
    },
    commands,
  };
}

export function commandRequiresExtensionHostAccess(command: CommandId): boolean {
  return deriveCommandRequirement(commandSchemas[command], command).hostAccess;
}

function deriveCommandRequirement(entry: CommandSchemaEntry, command: CommandId): ExtensionCommandRequirement {
  const securityReasons = [...getCommandSecurityMetadata(command).reasons];
  const manifestPermissions = new Set<FirefoxManifestPermission>();

  for (const reason of securityReasons) {
    for (const permission of privilegeManifestPermissions[reason]) {
      manifestPermissions.add(permission);
    }
  }

  return {
    command,
    securityReasons,
    hostAccess: commandNeedsHostAccess(entry, securityReasons),
    manifestPermissions: sorted(manifestPermissions),
    networkObservation: securityReasons.includes("network-observation"),
  };
}

function getCommandId(command: string): CommandId {
  if (isCommandId(command)) {
    return command;
  }
  throw new Error(`Unknown command id: ${command}`);
}

function commandNeedsHostAccess(entry: CommandSchemaEntry, securityReasons: readonly CommandPrivilegeReason[]): boolean {
  return (
    entry.owner === "extension" &&
    (entry.target !== "none" || entry.content !== "never" || entry.action || securityReasons.some((reason) => pageAccessReasons.has(reason)))
  );
}

function sorted<T extends string>(values: Iterable<T>): readonly T[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
