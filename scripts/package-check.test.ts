import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import rootPackage from "../package.json" with { type: "json" };
import { createTempDir } from "@firefox-cli/test-support";
import { getBinaryName, getPlatformKey, type PlatformInput } from "@firefox-cli/native-host";
import { verifyPackageLayout } from "./package-check.js";
import { createZipFixture, type ZipFixtureEntryInput } from "./zip-test-utils.js";

const platform: PlatformInput = {
  platform: "linux",
  arch: "x64",
};

describe("verifyPackageLayout", () => {
  it("accepts a complete development package layout", async () => {
    const packageRoot = await createPackageRoot();
    await verifyPackageLayout({ packageRoot, platform });
  });

  it("requires the real platform binary", async () => {
    const packageRoot = await createPackageRoot({ includeBinary: false });
    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow();
  });

  it("requires signed XPI for release checks", async () => {
    const packageRoot = await createPackageRoot();
    await expect(
      verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true }),
    ).rejects.toThrow("Expected signed extension XPI");
  });

  it("accepts a matching signed XPI with deflated data, data descriptors, and EOCD comments", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      compressionMethod: 8,
      eocdComment: "release candidate",
      signed: true,
      useDataDescriptor: true,
    });

    await verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true });
  });

  it("rejects renamed unsigned ZIPs for signed release checks", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, { signed: false });

    await expect(
      verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true }),
    ).rejects.toThrow("Expected signed extension XPI signature metadata");
  });

  it("rejects renamed unsigned ZIPs when present in default package checks", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, { signed: false });

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Expected signed extension XPI signature metadata",
    );
  });

  it("rejects malformed present XPIs instead of falling back to the development extension", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(join(packageRoot, "extension/firefox-cli.xpi"), "not a zip");

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "missing end of central directory",
    );
  });

  it("rejects invalid signed-XPI metadata for signed release checks", async () => {
    for (const signatureEntries of [
      { "META-INF/manifest.mf": "" },
      {
        "META-INF/manifest.mf": "manifest",
        "META-INF/mozilla.sf": "sf",
        "META-INF/mozilla.rsa": "rsa",
        "META-INF/unexpected.txt": "unexpected",
      },
      {
        "META-INF/manifest.mf": "manifest",
        "META-INF/mozilla.sf": "sf",
        "META-INF/mozilla.rsa": "rsa",
        "META-INF/cose.manifest": "cose",
      },
    ] as const) {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, { signatureEntries });

      await expect(
        verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true }),
      ).rejects.toThrow("signed extension metadata");
    }
  });

  it("rejects signed-XPI digest metadata that does not match the payload", async () => {
    const packageRoot = await createPackageRoot();
    await writeMatchingXpi(packageRoot, {
      signatureEntries: {
        "META-INF/manifest.mf":
          "Manifest-Version: 1.0\r\n\r\nName: manifest.json\r\nSHA256-Digest: invalid\r\n\r\n",
        "META-INF/mozilla.sf": "Signature-Version: 1.0\r\nSHA256-Digest-Manifest: invalid\r\n\r\n",
        "META-INF/mozilla.rsa": Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]),
      },
    });

    await expect(
      verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true }),
    ).rejects.toThrow("digest");
  });

  for (const requireSignedXpi of [false, true] as const) {
    const mode = requireSignedXpi ? "signed-release" : "default";

    it(`rejects stale same-version XPI payloads in ${mode} mode`, async () => {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, {
        payloadOverrides: {
          "background.js": "console.log('stale but same version');\n",
        },
      });

      await expect(
        verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi)),
      ).rejects.toThrow("payload differs from package file");
    });

    it(`rejects XPI path-set mismatches in ${mode} mode`, async () => {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, {
        payloadOverrides: {
          "unexpected.txt": "not part of the development payload",
        },
      });

      await expect(
        verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi)),
      ).rejects.toThrow("files outside the package payload");
    });

    it(`rejects missing XPI payload files in ${mode} mode`, async () => {
      const packageRoot = await createPackageRoot();
      await writeMatchingXpi(packageRoot, {
        payloadOverrides: {
          "popup.css": undefined,
        },
      });

      await expect(
        verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi)),
      ).rejects.toThrow("Expected extension artifact: popup.css");
    });

    it(`rejects signed manifest drift in ${mode} mode`, async () => {
      for (const manifestOverride of [
        { version: "9.9.9" },
        { browser_specific_settings: { gecko: { id: "wrong@example.invalid" } } },
        { permissions: ["nativeMessaging", "scripting"] },
        { host_permissions: [] },
      ] as const) {
        const packageRoot = await createPackageRoot();
        await writeMatchingXpi(packageRoot, {
          manifestOverride,
        });

        await expect(
          verifyPackageLayout(createPackageCheckOptions(packageRoot, requireSignedXpi)),
        ).rejects.toThrow("Expected extension");
      }
    });
  }

  it("ignores package-only development artifacts when comparing signed XPI payloads", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(join(packageRoot, "extension/development/README.md"), "package notes\n");
    await writeFile(
      join(packageRoot, `extension/development/firefox-cli-${rootPackage.version}.zip`),
      "development archive placeholder",
    );
    await writeMatchingXpi(packageRoot);

    await verifyPackageLayout({ packageRoot, platform, requireSignedXpi: true });
  });

  it("rejects malformed and wrong-shape package manifests", async () => {
    const malformed = await createPackageRoot();
    await writeFile(join(malformed, "package.json"), "{");
    await expect(verifyPackageLayout({ packageRoot: malformed, platform })).rejects.toThrow(
      "Invalid package manifest JSON",
    );

    const wrongShape = await createPackageRoot();
    await writeFile(
      join(wrongShape, "package.json"),
      JSON.stringify({ name: "firefox-cli", version: 1, bin: "bin/firefox-cli.js" }),
    );
    await expect(verifyPackageLayout({ packageRoot: wrongShape, platform })).rejects.toThrow(
      "Invalid package manifest",
    );
  });

  it("rejects malformed and wrong-shape development extension manifests", async () => {
    const malformed = await createPackageRoot();
    await writeFile(join(malformed, "extension/development/manifest.json"), "{");
    await expect(verifyPackageLayout({ packageRoot: malformed, platform })).rejects.toThrow(
      "Invalid development extension manifest JSON",
    );

    const wrongShape = await createPackageRoot();
    await writeFile(
      join(wrongShape, "extension/development/manifest.json"),
      JSON.stringify({
        manifest_version: 3,
        name: "firefox-cli",
        version: rootPackage.version,
        background: { scripts: "background.js" },
        permissions: "scripting",
        action: { default_popup: "popup.html" },
      }),
    );
    await expect(verifyPackageLayout({ packageRoot: wrongShape, platform })).rejects.toThrow(
      "Invalid development extension manifest",
    );
  });

  it("fails when packaged extension metadata drifts from the product version", async () => {
    const packageRoot = await createPackageRoot({ extensionVersion: "9.9.9" });

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Expected extension version",
    );
  });

  it("rejects extension bundles with shared JavaScript chunks", async () => {
    const packageRoot = await createPackageRoot();
    await mkdir(join(packageRoot, "extension/development/chunks"), { recursive: true });
    await writeFile(join(packageRoot, "extension/development/chunks/index.js"), "export {};\n");

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Unexpected extension JavaScript artifacts",
    );
  });

  it("rejects extension entry scripts that import generated chunks", async () => {
    const packageRoot = await createPackageRoot();
    await writeFile(
      join(packageRoot, "extension/development/background.js"),
      'import "./chunks/index.js";\n',
    );

    await expect(verifyPackageLayout({ packageRoot, platform })).rejects.toThrow(
      "Expected standalone extension script",
    );
  });
});

async function createPackageRoot(
  options: { readonly includeBinary?: boolean; readonly extensionVersion?: string } = {},
): Promise<string> {
  const packageRoot = await createTempDir("firefox-cli-package-check");
  const platformKey = getPlatformKey(platform);

  await mkdir(join(packageRoot, "bin", platformKey), { recursive: true });
  await mkdir(join(packageRoot, "extension/development"), { recursive: true });

  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: "firefox-cli",
        version: rootPackage.version,
        type: "module",
        bin: {
          "firefox-cli": "./bin/firefox-cli.js",
        },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(packageRoot, "README.md"), "# test\n");
  await writeFile(join(packageRoot, "LICENSE"), "MIT\n");
  await writeFile(join(packageRoot, "bin/firefox-cli.js"), "#!/usr/bin/env node\n");
  await mkdir(join(packageRoot, "lib"), { recursive: true });
  await writeFile(join(packageRoot, "lib/platform-binary.js"), "export {};\n");
  await writeFile(
    join(packageRoot, "extension/development/manifest.json"),
    `${JSON.stringify(
      {
        manifest_version: 3,
        name: "firefox-cli",
        version: options.extensionVersion ?? rootPackage.version,
        description: "Firefox extension shell for firefox-cli.",
        browser_specific_settings: {
          gecko: {
            id: "firefox-cli@example.invalid",
            strict_min_version: "109.0",
          },
        },
        background: { scripts: ["background.js"] },
        permissions: [
          "nativeMessaging",
          "scripting",
          "tabs",
          "storage",
          "downloads",
          "cookies",
          "clipboardRead",
          "clipboardWrite",
          "webRequest",
        ],
        host_permissions: ["<all_urls>"],
        action: { default_popup: "popup.html", default_title: "firefox-cli" },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(join(packageRoot, "extension/development/background.js"), "console.log('bg');\n");
  await writeFile(join(packageRoot, "extension/development/content.js"), "console.log('cs');\n");
  await writeFile(join(packageRoot, "extension/development/popup.js"), "console.log('popup');\n");
  await writeFile(join(packageRoot, "extension/development/popup.html"), "<!doctype html>\n");
  await writeFile(join(packageRoot, "extension/development/popup.css"), "body {}\n");

  if (options.includeBinary !== false) {
    await writeFile(join(packageRoot, "bin", platformKey, getBinaryName(platform)), "");
  }

  return packageRoot;
}

function createPackageCheckOptions(packageRoot: string, requireSignedXpi: boolean) {
  return requireSignedXpi
    ? { packageRoot, platform, requireSignedXpi: true }
    : { packageRoot, platform };
}

async function writeMatchingXpi(
  packageRoot: string,
  options: {
    readonly compressionMethod?: number;
    readonly eocdComment?: string;
    readonly manifestOverride?: Record<string, unknown>;
    readonly payloadOverrides?: Record<string, string | Buffer | undefined>;
    readonly signed?: boolean;
    readonly signatureEntries?: Record<string, string | Buffer>;
    readonly useDataDescriptor?: boolean;
  } = {},
): Promise<void> {
  const payload = await readDevelopmentPayload(packageRoot);
  for (const [file, data] of Object.entries(options.payloadOverrides ?? {})) {
    if (data === undefined) {
      payload.delete(file);
    } else {
      payload.set(file, Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8"));
    }
  }
  if (options.manifestOverride !== undefined) {
    const manifest = JSON.parse(payload.get("manifest.json")?.toString("utf8") ?? "{}") as Record<
      string,
      unknown
    >;
    payload.set(
      "manifest.json",
      Buffer.from(`${JSON.stringify({ ...manifest, ...options.manifestOverride }, null, 2)}\n`),
    );
  }

  const payloadEntries: ZipFixtureEntryInput[] = [...payload.entries()].map(([name, data]) => ({
    name,
    data,
    compressionMethod: options.compressionMethod ?? 0,
    ...(options.useDataDescriptor === undefined
      ? {}
      : { useDataDescriptor: options.useDataDescriptor }),
  }));
  const signatureEntries = createSignatureEntries(options, payload);
  const fixture = createZipFixture(
    [...payloadEntries, ...signatureEntries],
    options.eocdComment === undefined ? {} : { eocdComment: options.eocdComment },
  );

  await writeFile(join(packageRoot, "extension/firefox-cli.xpi"), fixture.data);
}

function createSignatureEntries(
  options: {
    readonly signatureEntries?: Record<string, string | Buffer>;
    readonly signed?: boolean;
  },
  payload: ReadonlyMap<string, Buffer>,
): readonly ZipFixtureEntryInput[] {
  if (options.signatureEntries !== undefined) {
    return Object.entries(options.signatureEntries).map(([name, data]) => ({
      name,
      data,
    }));
  }
  if (options.signed === false) {
    return [];
  }
  const manifestFile = createSignedManifest(payload);
  return [
    { name: "META-INF/manifest.mf", data: manifestFile },
    { name: "META-INF/mozilla.sf", data: createSignatureFile(manifestFile) },
    { name: "META-INF/mozilla.rsa", data: Buffer.from([0x30, 0x03, 0x02, 0x01, 0x00]) },
  ];
}

function createSignedManifest(payload: ReadonlyMap<string, Buffer>): Buffer {
  const lines = ["Manifest-Version: 1.0", ""];
  for (const [name, data] of [...payload.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`Name: ${name}`, `SHA256-Digest: ${sha256Digest(data)}`, "");
  }
  return Buffer.from(lines.join("\r\n"), "utf8");
}

function createSignatureFile(manifestFile: Buffer): Buffer {
  return Buffer.from(
    `Signature-Version: 1.0\r\nSHA256-Digest-Manifest: ${sha256Digest(manifestFile)}\r\n\r\n`,
    "utf8",
  );
}

function sha256Digest(data: Buffer): string {
  return createHash("sha256").update(data).digest("base64");
}

async function readDevelopmentPayload(packageRoot: string): Promise<Map<string, Buffer>> {
  const extensionRoot = join(packageRoot, "extension/development");
  const packageOnlyFiles = new Set(["README.md", `firefox-cli-${rootPackage.version}.zip`]);
  const files = (await listRelativeFiles(extensionRoot)).filter(
    (file) => !packageOnlyFiles.has(file),
  );
  const entries = await Promise.all(
    files.map(async (file) => [file, await readFile(join(extensionRoot, file))] as const),
  );
  return new Map(entries);
}

async function listRelativeFiles(root: string, prefix = ""): Promise<readonly string[]> {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const relativePath = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory() ? listRelativeFiles(root, relativePath) : [relativePath];
    }),
  );
  return files.flat();
}
