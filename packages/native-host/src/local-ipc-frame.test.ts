import { PassThrough, type Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { encodeLocalIpcJsonLine, readOneJsonLine } from "./local-ipc-frame.js";

describe("local IPC frames", () => {
  it("reads a newline-delimited JSON frame split across one-byte chunks", async () => {
    const socket = new PassThrough();
    const reading = readOneJsonLine(socket);

    writeOneByteChunks(socket, encodeLocalIpcJsonLine({ command: "chunked", value: 42 }));

    await expect(reading).resolves.toEqual({ command: "chunked", value: 42 });
  });
});

function writeOneByteChunks(socket: Duplex, data: Buffer): void {
  for (const byte of data) {
    socket.write(Buffer.from([byte]));
  }
}
