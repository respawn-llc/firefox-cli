export class BufferCursor {
  readonly #chunks: Buffer[] = [];
  #headOffset = 0;
  #availableBytes = 0;

  get availableBytes(): number {
    return this.#availableBytes;
  }

  append(chunk: Buffer | Uint8Array): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buffer.byteLength === 0) {
      return;
    }

    this.#chunks.push(buffer);
    this.#availableBytes += buffer.byteLength;
  }

  indexOf(byte: number): number {
    let offset = 0;
    for (const [index, chunk] of this.#chunks.entries()) {
      const start = index === 0 ? this.#headOffset : 0;
      const byteIndex = chunk.indexOf(byte, start);
      if (byteIndex >= 0) {
        return offset + byteIndex - start;
      }
      offset += chunk.byteLength - start;
    }

    return -1;
  }

  read(byteLength: number): Buffer {
    this.#assertReadableLength(byteLength);
    const output = Buffer.allocUnsafe(byteLength);
    this.#copyAndAdvance(output, byteLength);
    return output;
  }

  discard(byteLength: number): void {
    this.#assertReadableLength(byteLength);
    this.#copyAndAdvance(undefined, byteLength);
  }

  snapshot(): Buffer {
    const output = Buffer.allocUnsafe(this.#availableBytes);
    let written = 0;
    for (const [index, chunk] of this.#chunks.entries()) {
      const start = index === 0 ? this.#headOffset : 0;
      const length = chunk.byteLength - start;
      chunk.copy(output, written, start);
      written += length;
    }
    return output;
  }

  #assertReadableLength(byteLength: number): void {
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      throw new Error(`Invalid buffer cursor read length: ${String(byteLength)}`);
    }
    if (byteLength > this.#availableBytes) {
      throw new Error(
        `Buffer cursor read requires ${String(byteLength)} bytes, only ${String(this.#availableBytes)} available.`,
      );
    }
  }

  #copyAndAdvance(output: Buffer | undefined, byteLength: number): void {
    let remaining = byteLength;
    let written = 0;
    while (remaining > 0) {
      const chunk = this.#chunks[0];
      if (chunk === undefined) {
        throw new Error("Buffer cursor invariant violated: missing chunk.");
      }

      const availableInChunk = chunk.byteLength - this.#headOffset;
      const consumed = Math.min(remaining, availableInChunk);
      if (output !== undefined) {
        chunk.copy(output, written, this.#headOffset, this.#headOffset + consumed);
        written += consumed;
      }
      this.#headOffset += consumed;
      this.#availableBytes -= consumed;
      remaining -= consumed;

      if (this.#headOffset === chunk.byteLength) {
        this.#chunks.shift();
        this.#headOffset = 0;
      }
    }
  }
}
