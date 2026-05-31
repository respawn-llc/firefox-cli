export class BoundedOutput {
  readonly #maxBytes: number;
  readonly #chunks: Buffer[] = [];
  #bytes = 0;
  #truncated = false;

  constructor(maxBytes: number) {
    this.#maxBytes = maxBytes;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  append(chunk: Buffer | string): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.#chunks.push(buffer);
    this.#bytes += buffer.byteLength;
    this.#trim();
  }

  value(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }

  #trim(): void {
    while (this.#bytes > this.#maxBytes && this.#chunks.length > 0) {
      const overflow = this.#bytes - this.#maxBytes;
      const first = this.#chunks[0];
      if (first === undefined) {
        return;
      }
      this.#truncated = true;
      if (first.byteLength <= overflow) {
        this.#chunks.shift();
        this.#bytes -= first.byteLength;
        continue;
      }
      this.#chunks[0] = first.subarray(overflow);
      this.#bytes -= overflow;
    }
  }
}
