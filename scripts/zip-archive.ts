import { inflateRawSync } from "node:zlib";

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;
const ZIP64_VERSION_NEEDED = 45;
const ZIP_ENTRY_FLAG_ENCRYPTED = 0x0001;
const ZIP_ENTRY_FLAG_DATA_DESCRIPTOR = 0x0008;
const ZIP_COMPRESSION_STORED = 0;
const ZIP_COMPRESSION_DEFLATE = 8;
const MAX_EOCD_SEARCH_BYTES = UINT16_MAX + 22;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export interface ZipEntry {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly isDirectory: boolean;
}

type ParsedZipEntry = ZipEntry & {
  readonly dataOffset: number;
};

export interface ZipArchive {
  readonly entries: readonly ZipEntry[];
  readonly getEntry: (name: string) => ZipEntry | undefined;
  readonly readEntry: (entryOrName: ZipEntry | string) => Buffer;
}

export class ZipArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipArchiveError";
  }
}

export function readZipArchive(data: Buffer): ZipArchive {
  const eocdOffset = findEndOfCentralDirectory(data);
  const diskNumber = data.readUInt16LE(eocdOffset + 4);
  const centralDirectoryDisk = data.readUInt16LE(eocdOffset + 6);
  const diskEntryCount = data.readUInt16LE(eocdOffset + 8);
  const totalEntryCount = data.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = data.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = data.readUInt32LE(eocdOffset + 16);

  if (diskNumber !== 0 || centralDirectoryDisk !== 0 || diskEntryCount !== totalEntryCount) {
    throw new ZipArchiveError("Unsupported multi-disk ZIP archive.");
  }
  if (totalEntryCount === UINT16_MAX || centralDirectorySize === UINT32_MAX || centralDirectoryOffset === UINT32_MAX) {
    throw new ZipArchiveError("Unsupported ZIP64 archive.");
  }
  ensureRange(data, centralDirectoryOffset, centralDirectorySize, "central directory");
  if (centralDirectoryOffset + centralDirectorySize > eocdOffset) {
    throw new ZipArchiveError("Malformed ZIP archive: central directory overlaps EOCD.");
  }

  const parsedEntries = parseCentralDirectory(data, {
    entryCount: totalEntryCount,
    offset: centralDirectoryOffset,
    size: centralDirectorySize,
  });
  const entriesByName = new Map(parsedEntries.map((entry) => [entry.name, entry]));

  return {
    entries: parsedEntries,
    getEntry: (name) => entriesByName.get(name),
    readEntry: (entryOrName) => {
      const entry = typeof entryOrName === "string" ? entriesByName.get(entryOrName) : entriesByName.get(entryOrName.name);
      if (entry === undefined) {
        throw new ZipArchiveError(`ZIP entry not found: ${typeof entryOrName === "string" ? entryOrName : entryOrName.name}`);
      }
      if (entry.isDirectory) {
        throw new ZipArchiveError(`ZIP entry is a directory: ${entry.name}`);
      }
      return readEntryData(data, entry);
    },
  };
}

export function calculateCrc32(data: Buffer): number {
  let value = 0xffffffff;

  for (const byte of data) {
    const tableValue = crcTable[(value ^ byte) & 0xff];
    if (tableValue === undefined) {
      throw new ZipArchiveError("CRC32 table lookup failed.");
    }
    value = (value >>> 8) ^ tableValue;
  }

  return (value ^ 0xffffffff) >>> 0;
}

function findEndOfCentralDirectory(data: Buffer): number {
  const searchStart = Math.max(0, data.length - MAX_EOCD_SEARCH_BYTES);
  for (let offset = data.length - 22; offset >= searchStart; offset -= 1) {
    if (data.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      continue;
    }

    const commentLength = data.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength === data.length) {
      return offset;
    }
  }

  throw new ZipArchiveError("Malformed ZIP archive: missing end of central directory.");
}

function parseCentralDirectory(
  data: Buffer,
  input: { readonly entryCount: number; readonly offset: number; readonly size: number },
): readonly ParsedZipEntry[] {
  const entries: ParsedZipEntry[] = [];
  const seenNames = new Set<string>();
  let offset = input.offset;
  const endOffset = input.offset + input.size;

  for (let index = 0; index < input.entryCount; index += 1) {
    ensureRange(data, offset, 46, "central directory entry");
    if (data.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new ZipArchiveError("Malformed ZIP archive: invalid central directory header.");
    }

    const versionNeeded = data.readUInt16LE(offset + 6);
    const flags = data.readUInt16LE(offset + 8);
    const compressionMethod = data.readUInt16LE(offset + 10);
    const crc32 = data.readUInt32LE(offset + 16);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const fileNameLength = data.readUInt16LE(offset + 28);
    const extraFieldLength = data.readUInt16LE(offset + 30);
    const fileCommentLength = data.readUInt16LE(offset + 32);
    const diskStart = data.readUInt16LE(offset + 34);
    const localHeaderOffset = data.readUInt32LE(offset + 42);
    const variableStart = offset + 46;
    const variableLength = fileNameLength + extraFieldLength + fileCommentLength;
    ensureRange(data, variableStart, variableLength, "central directory entry fields");
    validateCentralDirectoryEntry({
      compressedSize,
      compressionMethod,
      diskStart,
      flags,
      localHeaderOffset,
      uncompressedSize,
      versionNeeded,
    });

    const name = data.subarray(variableStart, variableStart + fileNameLength).toString("utf8");
    validateEntryName(name);
    const normalizedName = normalizeEntryName(name);
    if (seenNames.has(normalizedName)) {
      throw new ZipArchiveError(`Duplicate ZIP entry: ${name}`);
    }
    seenNames.add(normalizedName);

    const dataOffset = readLocalDataOffset(data, {
      centralName: name,
      compressedSize,
      compressionMethod,
      crc32,
      flags,
      localHeaderOffset,
      uncompressedSize,
    });
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      crc32,
      isDirectory: name.endsWith("/"),
      dataOffset,
    });

    offset = variableStart + variableLength;
  }

  if (offset !== endOffset) {
    throw new ZipArchiveError("Malformed ZIP archive: central directory size mismatch.");
  }

  return entries;
}

function validateCentralDirectoryEntry(input: {
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly diskStart: number;
  readonly flags: number;
  readonly localHeaderOffset: number;
  readonly uncompressedSize: number;
  readonly versionNeeded: number;
}): void {
  if (input.versionNeeded >= ZIP64_VERSION_NEEDED) {
    throw new ZipArchiveError("Unsupported ZIP64 archive.");
  }
  if (input.diskStart !== 0) {
    throw new ZipArchiveError("Unsupported multi-disk ZIP archive.");
  }
  if ((input.flags & ZIP_ENTRY_FLAG_ENCRYPTED) !== 0) {
    throw new ZipArchiveError("Unsupported encrypted ZIP entry.");
  }
  if (input.compressedSize === UINT32_MAX || input.uncompressedSize === UINT32_MAX || input.localHeaderOffset === UINT32_MAX) {
    throw new ZipArchiveError("Unsupported ZIP64 archive.");
  }
  if (input.compressionMethod !== ZIP_COMPRESSION_STORED && input.compressionMethod !== ZIP_COMPRESSION_DEFLATE) {
    throw new ZipArchiveError(`Unsupported ZIP compression method: ${String(input.compressionMethod)}.`);
  }
}

function readLocalDataOffset(
  data: Buffer,
  input: {
    readonly centralName: string;
    readonly compressedSize: number;
    readonly compressionMethod: number;
    readonly crc32: number;
    readonly flags: number;
    readonly localHeaderOffset: number;
    readonly uncompressedSize: number;
  },
): number {
  ensureRange(data, input.localHeaderOffset, 30, "local file header");
  if (data.readUInt32LE(input.localHeaderOffset) !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new ZipArchiveError("Malformed ZIP archive: invalid local file header.");
  }

  const localFlags = data.readUInt16LE(input.localHeaderOffset + 6);
  const localCompressionMethod = data.readUInt16LE(input.localHeaderOffset + 8);
  const localCrc32 = data.readUInt32LE(input.localHeaderOffset + 14);
  const localCompressedSize = data.readUInt32LE(input.localHeaderOffset + 18);
  const localUncompressedSize = data.readUInt32LE(input.localHeaderOffset + 22);
  const localFileNameLength = data.readUInt16LE(input.localHeaderOffset + 26);
  const localExtraFieldLength = data.readUInt16LE(input.localHeaderOffset + 28);
  const localNameStart = input.localHeaderOffset + 30;
  const dataOffset = localNameStart + localFileNameLength + localExtraFieldLength;
  ensureRange(data, localNameStart, localFileNameLength + localExtraFieldLength, "local fields");
  ensureRange(data, dataOffset, input.compressedSize, "entry data");

  if ((localFlags & ZIP_ENTRY_FLAG_ENCRYPTED) !== 0) {
    throw new ZipArchiveError("Unsupported encrypted ZIP entry.");
  }
  if (
    (localFlags & (ZIP_ENTRY_FLAG_ENCRYPTED | ZIP_ENTRY_FLAG_DATA_DESCRIPTOR)) !==
    (input.flags & (ZIP_ENTRY_FLAG_ENCRYPTED | ZIP_ENTRY_FLAG_DATA_DESCRIPTOR))
  ) {
    throw new ZipArchiveError("Malformed ZIP archive: local entry flags mismatch.");
  }
  if (localCompressionMethod !== input.compressionMethod) {
    throw new ZipArchiveError("Malformed ZIP archive: local compression method mismatch.");
  }

  const localName = data.subarray(localNameStart, localNameStart + localFileNameLength).toString("utf8");
  if (localName !== input.centralName) {
    throw new ZipArchiveError("Malformed ZIP archive: local entry name mismatch.");
  }

  if ((localFlags & ZIP_ENTRY_FLAG_DATA_DESCRIPTOR) === 0) {
    if (localCrc32 !== input.crc32 || localCompressedSize !== input.compressedSize || localUncompressedSize !== input.uncompressedSize) {
      throw new ZipArchiveError("Malformed ZIP archive: local entry metadata mismatch.");
    }
  }

  return dataOffset;
}

function readEntryData(data: Buffer, entry: ParsedZipEntry): Buffer {
  const compressedData = data.subarray(entry.dataOffset, entry.dataOffset + entry.compressedSize);
  let output: Buffer;
  try {
    output = entry.compressionMethod === ZIP_COMPRESSION_STORED ? Buffer.from(compressedData) : inflateRawSync(compressedData);
  } catch (error) {
    throw new ZipArchiveError(`Failed to decompress ZIP entry ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (output.length !== entry.uncompressedSize) {
    throw new ZipArchiveError(`ZIP entry size mismatch: ${entry.name}`);
  }
  if (calculateCrc32(output) !== entry.crc32) {
    throw new ZipArchiveError(`ZIP entry CRC mismatch: ${entry.name}`);
  }

  return output;
}

function validateEntryName(name: string): void {
  if (name.length === 0) {
    throw new ZipArchiveError("Unsafe ZIP entry path: <empty>");
  }
  if (name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new ZipArchiveError(`Unsafe ZIP entry path: ${name}`);
  }

  const pathForParts = name.endsWith("/") ? name.slice(0, -1) : name;
  if (pathForParts.length === 0) {
    throw new ZipArchiveError(`Unsafe ZIP entry path: ${name}`);
  }

  const parts = pathForParts.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    throw new ZipArchiveError(`Unsafe ZIP entry path: ${name}`);
  }
}

function normalizeEntryName(name: string): string {
  return name.endsWith("/") ? name.slice(0, -1) : name;
}

function ensureRange(data: Buffer, offset: number, length: number, context: string): void {
  if (offset < 0 || length < 0 || !Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset + length > data.length) {
    throw new ZipArchiveError(`Malformed ZIP archive: ${context} is out of range.`);
  }
}
