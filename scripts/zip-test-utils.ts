import { deflateRawSync } from "node:zlib";
import { calculateCrc32 } from "./zip-archive.js";

export type ZipFixtureEntryInput = {
  readonly name: string;
  readonly data?: Buffer | string;
  readonly compressionMethod?: number;
  readonly crc32?: number;
  readonly useDataDescriptor?: boolean;
  readonly versionNeeded?: number;
};

export type ZipFixtureOptions = {
  readonly eocdComment?: Buffer | string;
  readonly diskNumber?: number;
  readonly centralDirectoryDisk?: number;
  readonly diskEntryCount?: number;
  readonly totalEntryCount?: number;
  readonly centralDirectorySize?: number;
  readonly centralDirectoryOffset?: number;
};

export type ZipFixture = {
  readonly data: Buffer;
  readonly localHeaderOffsets: readonly number[];
  readonly centralHeaderOffsets: readonly number[];
  readonly eocdOffset: number;
};

export function createZipFixture(
  entries: readonly ZipFixtureEntryInput[],
  options: ZipFixtureOptions = {},
): ZipFixture {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const localHeaderOffsets: number[] = [];
  const centralHeaderRelativeOffsets: number[] = [];
  let localOffset = 0;
  let centralOffset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source = toBuffer(entry.data ?? "");
    const compressionMethod = entry.compressionMethod ?? 0;
    const compressed = compressionMethod === 8 ? deflateRawSync(source) : Buffer.from(source);
    const crc32 = entry.crc32 ?? calculateCrc32(source);
    const useDataDescriptor = entry.useDataDescriptor === true;
    const flags = useDataDescriptor ? 0x0008 : 0;
    const versionNeeded = entry.versionNeeded ?? 20;
    const localHeader = createLocalHeader({
      compressedSize: compressed.length,
      compressionMethod,
      crc32Value: crc32,
      fileNameLength: name.length,
      flags,
      uncompressedSize: source.length,
      useDataDescriptor,
      versionNeeded,
    });
    const dataDescriptor = useDataDescriptor
      ? createDataDescriptor({
          compressedSize: compressed.length,
          crc32Value: crc32,
          uncompressedSize: source.length,
        })
      : Buffer.alloc(0);

    localHeaderOffsets.push(localOffset);
    localParts.push(localHeader, name, compressed, dataDescriptor);

    centralHeaderRelativeOffsets.push(centralOffset);
    const centralHeader = createCentralHeader({
      compressedSize: compressed.length,
      compressionMethod,
      crc32Value: crc32,
      fileNameLength: name.length,
      flags,
      localHeaderOffset: localOffset,
      uncompressedSize: source.length,
      versionNeeded,
    });
    centralParts.push(centralHeader, name);

    localOffset += localHeader.length + name.length + compressed.length + dataDescriptor.length;
    centralOffset += centralHeader.length + name.length;
  }

  const localDirectory = Buffer.concat(localParts);
  const centralDirectory = Buffer.concat(centralParts);
  const eocdOffset = localDirectory.length + centralDirectory.length;
  const comment = toBuffer(options.eocdComment ?? "");
  const endRecord = createEndRecord({
    centralDirectoryOffset: options.centralDirectoryOffset ?? localDirectory.length,
    centralDirectorySize: options.centralDirectorySize ?? centralDirectory.length,
    commentLength: comment.length,
    diskEntryCount: options.diskEntryCount ?? entries.length,
    diskNumber: options.diskNumber ?? 0,
    centralDirectoryDisk: options.centralDirectoryDisk ?? 0,
    totalEntryCount: options.totalEntryCount ?? entries.length,
  });

  return {
    data: Buffer.concat([localDirectory, centralDirectory, endRecord, comment]),
    localHeaderOffsets,
    centralHeaderOffsets: centralHeaderRelativeOffsets.map(
      (offset) => localDirectory.length + offset,
    ),
    eocdOffset,
  };
}

function createLocalHeader(input: {
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly crc32Value: number;
  readonly fileNameLength: number;
  readonly flags: number;
  readonly uncompressedSize: number;
  readonly useDataDescriptor: boolean;
  readonly versionNeeded: number;
}): Buffer {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt32LE(0x04034b50, 0);
  buffer.writeUInt16LE(input.versionNeeded, 4);
  buffer.writeUInt16LE(input.flags, 6);
  buffer.writeUInt16LE(input.compressionMethod, 8);
  buffer.writeUInt16LE(0, 10);
  buffer.writeUInt16LE(33, 12);
  buffer.writeUInt32LE(input.useDataDescriptor ? 0 : input.crc32Value, 14);
  buffer.writeUInt32LE(input.useDataDescriptor ? 0 : input.compressedSize, 18);
  buffer.writeUInt32LE(input.useDataDescriptor ? 0 : input.uncompressedSize, 22);
  buffer.writeUInt16LE(input.fileNameLength, 26);
  buffer.writeUInt16LE(0, 28);
  return buffer;
}

function createCentralHeader(input: {
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly crc32Value: number;
  readonly fileNameLength: number;
  readonly flags: number;
  readonly localHeaderOffset: number;
  readonly uncompressedSize: number;
  readonly versionNeeded: number;
}): Buffer {
  const buffer = Buffer.alloc(46);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(20, 4);
  buffer.writeUInt16LE(input.versionNeeded, 6);
  buffer.writeUInt16LE(input.flags, 8);
  buffer.writeUInt16LE(input.compressionMethod, 10);
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

function createDataDescriptor(input: {
  readonly compressedSize: number;
  readonly crc32Value: number;
  readonly uncompressedSize: number;
}): Buffer {
  const buffer = Buffer.alloc(16);
  buffer.writeUInt32LE(0x08074b50, 0);
  buffer.writeUInt32LE(input.crc32Value, 4);
  buffer.writeUInt32LE(input.compressedSize, 8);
  buffer.writeUInt32LE(input.uncompressedSize, 12);
  return buffer;
}

function createEndRecord(input: {
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly commentLength: number;
  readonly centralDirectoryDisk: number;
  readonly diskEntryCount: number;
  readonly diskNumber: number;
  readonly totalEntryCount: number;
}): Buffer {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(input.diskNumber, 4);
  buffer.writeUInt16LE(input.centralDirectoryDisk, 6);
  buffer.writeUInt16LE(input.diskEntryCount, 8);
  buffer.writeUInt16LE(input.totalEntryCount, 10);
  buffer.writeUInt32LE(input.centralDirectorySize, 12);
  buffer.writeUInt32LE(input.centralDirectoryOffset, 16);
  buffer.writeUInt16LE(input.commentLength, 20);
  return buffer;
}

function toBuffer(value: Buffer | string): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
}
