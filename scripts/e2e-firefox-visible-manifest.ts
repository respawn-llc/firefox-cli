import { homedir } from "node:os";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type NativeMessagingManifestPlan, planNativeMessagingManifest } from "@firefox-cli/native-host";

export async function installFirefoxVisibleManifest(plan: NativeMessagingManifestPlan, disposableHomeDir: string): Promise<() => Promise<void>> {
  if (process.platform !== "darwin") {
    return async () => undefined;
  }

  const firefoxHomeDir = homedir();
  if (firefoxHomeDir === disposableHomeDir) {
    return async () => undefined;
  }

  const firefoxPlan = planNativeMessagingManifest({
    binaryPath: plan.manifest.path,
    platform: process.platform,
    homeDir: firefoxHomeDir,
  });
  if (firefoxPlan.manifestPath === plan.manifestPath) {
    return async () => undefined;
  }

  const original = await readOptionalFile(firefoxPlan.manifestPath);
  const temporary = `${JSON.stringify(firefoxPlan.manifest, null, 2)}\n`;
  await mkdir(dirname(firefoxPlan.manifestPath), { recursive: true });
  await writeFile(firefoxPlan.manifestPath, temporary);

  return async () => {
    const current = await readOptionalFile(firefoxPlan.manifestPath);
    if (current !== temporary) {
      console.error(`Disposable Firefox E2E left ${firefoxPlan.manifestPath} unchanged because it was modified during the run.`);
      return;
    }
    if (original === null) {
      await unlink(firefoxPlan.manifestPath).catch((error: unknown) => {
        if (!isNodeErrorCode(error, "ENOENT")) {
          throw error;
        }
      });
      return;
    }
    await writeFile(firefoxPlan.manifestPath, original);
  };
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
