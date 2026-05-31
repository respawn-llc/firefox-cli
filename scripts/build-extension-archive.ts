import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import rootPackage from "../package.json" with { type: "json" };
import { listRegularFilesUnder, readRegularFile } from "./safe-extension-files.js";
import { calculateCrc32 } from "./zip-archive.js";

const sourceDir = resolve("dist/extension");
const artifactDir = resolve("dist/extension-artifacts");
const artifactPath = resolve(artifactDir, `firefox-cli-${rootPackage.version}.zip`);

await mkdir(artifactDir, { recursive: true });

const files = await listRegularFilesUnder(sourceDir, "development extension archive");
const records = await Promise.all(
  files.map(async (file) => {
    const data = await readRegularFile(
      file.absolutePath,
      `development extension archive ${file.relativePath}`,
    );
    return {
      name: file.relativePath,
      data,
      crc32: calculateCrc32(data),
    };
  }),
);

records.sort((left, right) => left.name.localeCompare(right.name));

let offset = 0;
const localParts: Buffer[] = [];
const centralParts: Buffer[] = [];

for (const record of records) {
  const name = Buffer.from(record.name, "utf8");
  const localHeader = createLocalHeader({
    crc32Value: record.crc32,
    compressedSize: record.data.length,
    uncompressedSize: record.data.length,
    fileNameLength: name.length,
  });

  localParts.push(localHeader, name, record.data);

  centralParts.push(
    createCentralHeader({
      crc32Value: record.crc32,
      compressedSize: record.data.length,
      uncompressedSize: record.data.length,
      fileNameLength: name.length,
      localHeaderOffset: offset,
    }),
    name,
  );

  offset += localHeader.length + name.length + record.data.length;
}

const centralDirectory = Buffer.concat(centralParts);
const localDirectory = Buffer.concat(localParts);
const endRecord = createEndRecord({
  entries: records.length,
  centralDirectorySize: centralDirectory.length,
  centralDirectoryOffset: localDirectory.length,
});

await writeFile(artifactPath, Buffer.concat([localDirectory, centralDirectory, endRecord]));

console.log(`Built deterministic extension archive: ${artifactPath}`);

function createLocalHeader(input: {
  readonly crc32Value: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly fileNameLength: number;
}): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt32LE(0x04034b50, 0);
  buffer.writeUInt16LE(20, 4);
  buffer.writeUInt16LE(0x0800, 6);
  buffer.writeUInt16LE(0, 8);
  buffer.writeUInt16LE(0, 10);
  buffer.writeUInt16LE(33, 12);
  buffer.writeUInt32LE(input.crc32Value, 14);
  buffer.writeUInt32LE(input.compressedSize, 18);
  buffer.writeUInt32LE(input.uncompressedSize, 22);
  buffer.writeUInt16LE(input.fileNameLength, 26);
  buffer.writeUInt16LE(0, 28);
  return buffer;
}

function createCentralHeader(input: {
  readonly crc32Value: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly fileNameLength: number;
  readonly localHeaderOffset: number;
}): Buffer {
  const buffer = Buffer.alloc(46);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(20, 4);
  buffer.writeUInt16LE(20, 6);
  buffer.writeUInt16LE(0x0800, 8);
  buffer.writeUInt16LE(0, 10);
  buffer.writeUInt16LE(0, 12);
  buffer.writeUInt16LE(33, 14);
  buffer.writeUInt32LE(input.crc32Value, 16);
  buffer.writeUInt32LE(input.compressedSize, 20);
  buffer.writeUInt32LE(input.uncompressedSize, 24);
  buffer.writeUInt16LE(input.fileNameLength, 28);
  buffer.writeUInt16LE(0, 30);
  buffer.writeUInt16LE(0, 32);
  buffer.writeUInt16LE(0, 34);
  buffer.writeUInt16LE(0, 36);
  buffer.writeUInt32LE(0, 38);
  buffer.writeUInt32LE(input.localHeaderOffset, 42);
  return buffer;
}

function createEndRecord(input: {
  readonly entries: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryOffset: number;
}): Buffer {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(0, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(input.entries, 8);
  buffer.writeUInt16LE(input.entries, 10);
  buffer.writeUInt32LE(input.centralDirectorySize, 12);
  buffer.writeUInt32LE(input.centralDirectoryOffset, 16);
  buffer.writeUInt16LE(0, 20);
  return buffer;
}
