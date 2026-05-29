export const DEFAULT_MAX_OUTPUT_BYTES = 60_000;

export function truncateText(
  text: string,
  maxBytes: number,
): { readonly text: string; readonly truncated: boolean } {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) {
    return { text, truncated: false };
  }

  const marker = "[truncated]";
  if (encoder.encode(marker).length > maxBytes) {
    return { text: truncateToByteLimit(marker, maxBytes), truncated: true };
  }

  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const candidate = [...lines, line, marker].join("\n");
    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }
    lines.push(line);
  }

  return {
    text: [...lines, marker].join("\n"),
    truncated: true,
  };
}

function truncateToByteLimit(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let truncated = "";
  for (const char of text) {
    const candidate = `${truncated}${char}`;
    if (encoder.encode(candidate).length > maxBytes) {
      break;
    }
    truncated = candidate;
  }
  return truncated;
}

export function escapeCssString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
