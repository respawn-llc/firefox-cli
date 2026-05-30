import type { Socket } from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { encodeLocalIpcJsonLine, readOneJsonLine } from "./local-ipc-frame.js";

describe("local IPC frames", () => {
  it("reads a newline-delimited JSON frame split across one-byte chunks", async () => {
    const socket = new PassThrough() as unknown as Socket;
    const reading = readOneJsonLine(socket);

    writeOneByteChunks(socket, encodeLocalIpcJsonLine({ command: "chunked", value: 42 }));

    await expect(reading).resolves.toEqual({ command: "chunked", value: 42 });
  });
});

function writeOneByteChunks(socket: Socket, data: Buffer): void {
  for (const byte of data) {
    socket.write(Buffer.from([byte]));
  }
}
