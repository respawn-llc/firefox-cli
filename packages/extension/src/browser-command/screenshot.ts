import { BrowserCommandError } from "./errors.js";

export function parseImageDataUrl(
  dataUrl: string,
  format: "png" | "jpeg",
  maxImageBytes: number,
): {
  readonly base64: string;
  readonly bytes: number;
  readonly width?: number;
  readonly height?: number;
} {
  const prefix = `data:image/${format};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    throw new BrowserCommandError("CAPTURE_FAILED", `Firefox did not return a ${format.toUpperCase()} screenshot.`);
  }

  const base64 = dataUrl.slice(prefix.length);
  const bytes = base64DecodedLength(base64);
  if (bytes <= 0) {
    throw new BrowserCommandError("CAPTURE_FAILED", "Firefox returned an empty screenshot.");
  }
  if (bytes > maxImageBytes) {
    throw new BrowserCommandError("OUTPUT_TOO_LARGE", `Screenshot is ${String(bytes)} bytes, exceeding the ${String(maxImageBytes)} byte limit.`);
  }

  return {
    base64,
    bytes,
    ...(format === "png" ? parsePngDimensions(base64) : {}),
  };
}

function base64DecodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function parsePngDimensions(base64: string): { readonly width?: number; readonly height?: number } {
  try {
    const header = atob(base64.slice(0, 32));
    const bytes = Uint8Array.from(header, (character) => character.charCodeAt(0));
    const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
    const isPng = pngSignature.every((byte, index) => bytes[index] === byte);
    if (!isPng || bytes.length < 24) {
      throw new Error("Invalid PNG header.");
    }

    return {
      width: readUint32(bytes, 16),
      height: readUint32(bytes, 20),
    };
  } catch (error) {
    throw new BrowserCommandError("CAPTURE_FAILED", `Firefox returned invalid PNG data: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) * 0x1000000 + ((bytes[offset + 1] ?? 0) << 16) + ((bytes[offset + 2] ?? 0) << 8) + (bytes[offset + 3] ?? 0);
}
