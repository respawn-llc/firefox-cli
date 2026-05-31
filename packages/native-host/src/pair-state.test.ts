import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createTempDir } from "@firefox-cli/test-support";
import { describe, expect, it } from "vitest";
import { FIREFOX_CLI_EXTENSION_ID } from "./host-launch.js";
import {
  FileHostIdentityStore,
  FilePairStateStore,
  approvePairing,
  createHostIdentity,
  getOrCreateHostIdentity,
  rotatePairToken,
  readPairStateStatus,
  unpair,
  verifyPairStateStatus,
  verifyPairToken,
} from "./pair-state.js";

describe("pair state", () => {
  it("generates a host identity and approves a first-use pair token", () => {
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    const approval = approvePairing(hostIdentity, {
      now: () => new Date("2026-01-02T03:04:05.000Z"),
      randomBytes: () => Buffer.from("first-secret"),
    });

    expect(approval.token).not.toBe(approval.state.tokenHash);
    expect(approval.state).toEqual({
      schemaVersion: 1,
      hostId: "host-1",
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      tokenHash: "0VXfoNaTaDnuuCVvI-PO7ztmyis1XthBHFckboMeouE",
      approvedAt: "2026-01-02T03:04:05.000Z",
      generation: 1,
    });
    expect(verifyPairToken(approval.state, hostIdentity, approval.token)).toEqual({ ok: true });
  });

  it("rotates pair tokens and invalidates the previous token", () => {
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    const first = approvePairing(hostIdentity, {
      randomBytes: () => Buffer.from("first-secret"),
    });
    const second = rotatePairToken(first.state, {
      now: () => new Date("2026-01-03T03:04:05.000Z"),
      randomBytes: () => Buffer.from("second-secret"),
    });

    expect(second.state.generation).toBe(2);
    expect(verifyPairToken(second.state, hostIdentity, second.token)).toEqual({ ok: true });
    expect(verifyPairToken(second.state, hostIdentity, first.token)).toEqual({
      ok: false,
      code: "TOKEN_MISMATCH",
      message: "Pair token does not match the approved extension.",
    });
  });

  it("returns actionable mismatch errors for host, extension, and extension reset cases", () => {
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    const approval = approvePairing(hostIdentity, {
      randomBytes: () => Buffer.from("first-secret"),
    });

    expect(verifyPairToken(approval.state, { ...hostIdentity, hostId: "host-2" }, approval.token)).toEqual({
      ok: false,
      code: "HOST_ID_MISMATCH",
      message: "Native host identity changed after approval.",
    });
    expect(verifyPairToken(approval.state, { ...hostIdentity, extensionId: "other@example.invalid" }, approval.token)).toEqual({
      ok: false,
      code: "EXTENSION_ID_MISMATCH",
      message: "Extension identity does not match the approved pair state.",
    });
    expect(verifyPairToken(approval.state, hostIdentity, undefined)).toEqual({
      ok: false,
      code: "TOKEN_REQUIRED",
      message: "Extension is not paired with this native host.",
    });
  });

  it("reports not approved when no pair state exists", () => {
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });

    expect(verifyPairToken(null, hostIdentity, "token")).toEqual({
      ok: false,
      code: "NOT_APPROVED",
      message: "Native host has not been approved by the extension popup.",
    });
  });

  it("stores pair state under a temp-rootable user-local file", async () => {
    const rootDir = await createTempDir("firefox-cli-pair-state");
    const store = new FilePairStateStore({
      rootDir,
      platform: "darwin",
    });
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    const approval = approvePairing(hostIdentity, {
      randomBytes: () => Buffer.from("first-secret"),
    });

    await expect(store.read()).resolves.toBeNull();
    await store.write(approval.state);
    await expect(store.read()).resolves.toEqual(approval.state);
    await expect(readFile(join(rootDir, "Library/Application Support/firefox-cli/pair-state.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(approval.state, null, 2)}\n`,
    );

    if (process.platform !== "win32") {
      const mode = (await stat(store.filePath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("clears stored pair state on unpair", async () => {
    const rootDir = await createTempDir("firefox-cli-pair-state");
    const store = new FilePairStateStore({
      rootDir,
      platform: "linux",
    });
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    const approval = approvePairing(hostIdentity, {
      randomBytes: () => Buffer.from("first-secret"),
    });

    await store.write(approval.state);
    await unpair(store);

    await expect(store.read()).resolves.toBeNull();
  });

  it("rejects malformed pair state without clearing the file", async () => {
    const rootDir = await createTempDir("firefox-cli-pair-state");
    const store = new FilePairStateStore({
      filePath: join(rootDir, "pair-state.json"),
    });

    await writeFile(store.filePath, "{");

    await expect(store.read()).rejects.toMatchObject({
      kind: "invalid-json",
      filePath: store.filePath,
    });
    await expect(readFile(store.filePath, "utf8")).resolves.toBe("{");
  });

  it("classifies wrong-shape pair state as invalid for token verification", async () => {
    const rootDir = await createTempDir("firefox-cli-pair-state");
    const store = new FilePairStateStore({
      filePath: join(rootDir, "pair-state.json"),
    });
    const hostIdentity = createHostIdentity({
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    await writeFile(
      store.filePath,
      JSON.stringify({
        schemaVersion: 1,
        hostId: "host-1",
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        tokenHash: "hash",
        approvedAt: "2026-01-02T03:04:05.000Z",
        generation: "1",
      }),
    );

    const status = await readPairStateStatus(store);

    expect(status).toMatchObject({ status: "invalid" });
    expect(verifyPairStateStatus(status, hostIdentity, "token")).toMatchObject({
      ok: false,
      code: "PAIR_STATE_INVALID",
    });
  });

  it("persists the host identity across native-host restarts", async () => {
    const rootDir = await createTempDir("firefox-cli-host-identity");
    const store = new FileHostIdentityStore({
      rootDir,
      platform: "darwin",
    });

    const first = await getOrCreateHostIdentity(store, {
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-1",
    });
    const second = await getOrCreateHostIdentity(store, {
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-2",
    });

    expect(first).toEqual({
      hostId: "host-1",
      extensionId: FIREFOX_CLI_EXTENSION_ID,
    });
    expect(second).toEqual(first);
    await expect(readFile(join(rootDir, "Library/Application Support/firefox-cli/host-identity.json"), "utf8")).resolves.toBe(
      `${JSON.stringify(first, null, 2)}\n`,
    );

    if (process.platform !== "win32") {
      const mode = (await stat(store.filePath)).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("serializes concurrent first-start host identity creation", async () => {
    const rootDir = await createTempDir("firefox-cli-host-identity-race");
    const store = new FileHostIdentityStore({
      filePath: join(rootDir, "host-identity.json"),
    });
    let nextId = 0;

    const [first, second] = await Promise.all([
      getOrCreateHostIdentity(store, {
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => {
          nextId += 1;
          return `host-${String(nextId)}`;
        },
      }),
      getOrCreateHostIdentity(store, {
        extensionId: FIREFOX_CLI_EXTENSION_ID,
        generateId: () => {
          nextId += 1;
          return `host-${String(nextId)}`;
        },
      }),
    ]);

    expect(first).toEqual(second);
    await expect(store.read()).resolves.toEqual(first);
  });

  it("regenerates malformed host identity files without clearing pair state", async () => {
    const rootDir = await createTempDir("firefox-cli-host-identity");
    const store = new FileHostIdentityStore({
      filePath: join(rootDir, "host-identity.json"),
    });
    await writeFile(store.filePath, JSON.stringify({ extensionId: FIREFOX_CLI_EXTENSION_ID }));

    const identity = await getOrCreateHostIdentity(store, {
      extensionId: FIREFOX_CLI_EXTENSION_ID,
      generateId: () => "host-2",
    });

    expect(identity).toEqual({
      hostId: "host-2",
      extensionId: FIREFOX_CLI_EXTENSION_ID,
    });
    await expect(readFile(store.filePath, "utf8")).resolves.toContain("host-2");
  });
});
