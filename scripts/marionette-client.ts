import { createConnection, type Socket } from "node:net";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FIREFOX_CLI_EXTENSION_ID } from "@firefox-cli/native-host";

export async function approveExtensionWithMarionette(profileDir: string): Promise<void> {
  const port = await waitForMarionettePort(profileDir);
  const client = await MarionetteClient.connect(port);
  try {
    await client.send("WebDriver:NewSession", { capabilities: { alwaysMatch: {} } });
    await client.send("Marionette:SetContext", { value: "chrome" });
    const popupUrl = webDriverValue(
      await client.send("WebDriver:ExecuteScript", {
        script: `return WebExtensionPolicy.getByID(arguments[0]).getURL("popup.html");`,
        args: [FIREFOX_CLI_EXTENSION_ID],
      }),
    );
    if (typeof popupUrl !== "string") {
      throw new Error(`Marionette did not return the extension popup URL: ${String(popupUrl)}`);
    }

    await client.send("Marionette:SetContext", { value: "content" });
    await client.send("WebDriver:Navigate", { url: popupUrl });
    const element = webDriverValue(
      await client.send("WebDriver:FindElement", {
        using: "css selector",
        value: "#approve",
      }),
    );
    await client.send("WebDriver:ElementClick", { id: marionetteElementId(element) });
  } finally {
    client.close();
  }
}

async function waitForMarionettePort(profileDir: string): Promise<number> {
  const portFile = join(profileDir, "MarionetteActivePort");
  return pollUntil(
    async () => {
      try {
        const content = await readFile(portFile, "utf8");
        const port = Number(content.trim().split("\n")[0]);
        return Number.isInteger(port) && port > 0 ? port : false;
      } catch {
        return false;
      }
    },
    {
      timeoutMs: 20_000,
      intervalMs: 100,
      timeoutMessage: () => `Timed out waiting for MarionetteActivePort in ${profileDir}.`,
    },
  );
}

function marionetteElementId(value: unknown): string {
  if (value === null || typeof value !== "object") {
    throw new Error(`Marionette did not return an element object: ${String(value)}`);
  }

  const record = value as Record<string, unknown>;
  const elementId = record["element-6066-11e4-a52e-4f735466cecf"] ?? record.ELEMENT;
  if (typeof elementId !== "string") {
    throw new Error(
      `Marionette element object did not include an element id: ${JSON.stringify(value)}`,
    );
  }
  return elementId;
}

function webDriverValue(value: unknown): unknown {
  if (value !== null && typeof value === "object" && "value" in value) {
    return (value as { readonly value: unknown }).value;
  }
  return value;
}

class MarionetteClient {
  readonly #socket: Socket;
  #buffer = Buffer.alloc(0);
  #nextId = 0;
  readonly #pending = new Map<
    number,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: Error) => void;
    }
  >();

  private constructor(socket: Socket) {
    this.#socket = socket;
    this.#socket.on("data", (chunk) => {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      this.#parse();
    });
    this.#socket.on("error", (error) => {
      for (const pending of this.#pending.values()) {
        pending.reject(error);
      }
      this.#pending.clear();
    });
  }

  static async connect(port: number): Promise<MarionetteClient> {
    const socket = createConnection(port, "127.0.0.1");
    const client = new MarionetteClient(socket);
    await new Promise<void>((resolveConnect, rejectConnect) => {
      socket.once("connect", () => resolveConnect());
      socket.once("error", rejectConnect);
    });
    await sleep(100);
    return client;
  }

  async send(command: string, params: Record<string, unknown>): Promise<unknown> {
    const id = ++this.#nextId;
    const payload = JSON.stringify([0, id, command, params]);
    const response = new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
    });
    this.#socket.write(`${Buffer.byteLength(payload)}:${payload}`);
    return withTimeout(response, 10_000, `Marionette command timed out: ${command}`);
  }

  close(): void {
    this.#socket.end();
  }

  #parse(): void {
    while (true) {
      const separatorIndex = this.#buffer.indexOf(":");
      if (separatorIndex < 0) {
        return;
      }

      const byteLength = Number(this.#buffer.subarray(0, separatorIndex).toString("ascii"));
      if (!Number.isInteger(byteLength) || byteLength < 0) {
        throw new Error(
          `Invalid Marionette frame length: ${this.#buffer
            .subarray(0, separatorIndex)
            .toString("ascii")}`,
        );
      }

      const frameStart = separatorIndex + 1;
      const frameEnd = frameStart + byteLength;
      if (this.#buffer.length < frameEnd) {
        return;
      }

      const frame = this.#buffer.subarray(frameStart, frameEnd).toString("utf8");
      this.#buffer = this.#buffer.subarray(frameEnd);
      const message = JSON.parse(frame) as unknown;
      if (!Array.isArray(message)) {
        continue;
      }

      const [, id, error, result] = message;
      if (typeof id !== "number") {
        continue;
      }

      const pending = this.#pending.get(id);
      if (pending === undefined) {
        continue;
      }
      this.#pending.delete(id);
      if (error !== null && error !== undefined) {
        pending.reject(new Error(JSON.stringify(error)));
      } else {
        pending.resolve(result);
      }
    }
  }
}

async function pollUntil<T>(
  check: () => Promise<T | false>,
  options: {
    readonly timeoutMs: number;
    readonly intervalMs: number;
    readonly timeoutMessage: () => string;
  },
): Promise<T> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < options.timeoutMs) {
    const value = await check();
    if (value !== false) {
      return value;
    }
    await sleep(options.intervalMs);
  }

  throw new Error(options.timeoutMessage());
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
