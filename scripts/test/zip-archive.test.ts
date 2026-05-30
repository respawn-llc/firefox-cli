import { describe, expect, it } from "vitest";
import { readZipArchive, ZipArchiveError } from "../zip-archive.js";
import { createZipFixture } from "./zip-test-utils.js";

describe("readZipArchive", () => {
  it("reads deflated entries and EOCD comments", () => {
    const fixture = createZipFixture(
      [{ name: "manifest.json", data: '{"ok":true}', compressionMethod: 8 }],
      { eocdComment: "signed xpi comment" },
    );

    const archive = readZipArchive(fixture.data);

    expect(archive.entries.map((entry) => entry.name)).toEqual(["manifest.json"]);
    expect(archive.readEntry("manifest.json").toString("utf8")).toBe('{"ok":true}');
  });

  it("uses central-directory sizes when local headers rely on data descriptors", () => {
    const fixture = createZipFixture([
      {
        name: "background.js",
        data: "console.log('ready');\n",
        compressionMethod: 8,
        useDataDescriptor: true,
      },
    ]);

    const archive = readZipArchive(fixture.data);

    expect(archive.readEntry("background.js").toString("utf8")).toContain("ready");
  });

  it("rejects duplicate entry names", () => {
    const fixture = createZipFixture([
      { name: "manifest.json", data: "{}" },
      { name: "manifest.json", data: "{}" },
    ]);

    expect(() => readZipArchive(fixture.data)).toThrow("Duplicate ZIP entry");
  });

  it("rejects unsafe entry paths", () => {
    const fixture = createZipFixture([{ name: "../manifest.json", data: "{}" }]);

    expect(() => readZipArchive(fixture.data)).toThrow("Unsafe ZIP entry path");
  });

  it("rejects unsupported compression methods", () => {
    const fixture = createZipFixture([
      { name: "manifest.json", data: "{}", compressionMethod: 99 },
    ]);

    expect(() => readZipArchive(fixture.data)).toThrow("Unsupported ZIP compression method");
  });

  it("rejects ZIP64-style central directory entries", () => {
    const fixture = createZipFixture([{ name: "manifest.json", data: "{}", versionNeeded: 45 }]);

    expect(() => readZipArchive(fixture.data)).toThrow("Unsupported ZIP64 archive");
  });

  it("rejects multi-disk EOCD metadata", () => {
    const fixture = createZipFixture([{ name: "manifest.json", data: "{}" }], {
      diskNumber: 1,
    });

    expect(() => readZipArchive(fixture.data)).toThrow("Unsupported multi-disk ZIP archive");
  });

  it("rejects malformed local headers", () => {
    const fixture = createZipFixture([{ name: "manifest.json", data: "{}" }]);
    const corrupted = Buffer.from(fixture.data);
    corrupted.writeUInt32LE(0, fixture.localHeaderOffsets[0] ?? 0);

    expect(() => readZipArchive(corrupted)).toThrow("invalid local file header");
  });

  it("rejects malformed central headers", () => {
    const fixture = createZipFixture([{ name: "manifest.json", data: "{}" }]);
    const corrupted = Buffer.from(fixture.data);
    corrupted.writeUInt32LE(0, fixture.centralHeaderOffsets[0] ?? 0);

    expect(() => readZipArchive(corrupted)).toThrow("invalid central directory header");
  });

  it("rejects CRC mismatches when entries are read", () => {
    const fixture = createZipFixture([{ name: "manifest.json", data: "{}", crc32: 0 }]);
    const archive = readZipArchive(fixture.data);

    expect(() => archive.readEntry("manifest.json")).toThrow("CRC mismatch");
  });

  it("throws structured ZIP archive errors", () => {
    expect(() => readZipArchive(Buffer.from("not a zip"))).toThrow(ZipArchiveError);
  });
});
