import {
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import {
  FileServiceAvailabilityReconciliationSchedulerCursorStore,
  FileServiceAvailabilityReconciliationSchedulerCursorStoreError,
  type FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies,
} from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe("FileServiceAvailabilityReconciliationSchedulerCursorStore", () => {
  it("is frozen, exposes only the store API, and performs no construction work", () => {
    const dependencies = createControlledDependencies();

    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    expect(Object.isFrozen(store)).toBe(true);
    expect(Object.keys(store)).toEqual([]);
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(store) as object).sort(),
    ).toEqual(["advance", "constructor", "read"]);
    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
    expect(dependencies.unlink).not.toHaveBeenCalled();
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
  });

  it("treats only a missing target file as empty state", async () => {
    const { filePath } = await createTemporaryCursorPath();
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );

    await expect(store.read()).resolves.toBeNull();
    await expect(readdir(dirname(filePath))).resolves.toEqual([]);
  });

  it("reconstructs a canonical cursor from a valid version-one file", async () => {
    const { filePath } = await createTemporaryCursorPath();
    await writeCursorFile(filePath, "2026-07-26T12:30:00.000Z");
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );

    const first = await store.read();
    const second = await store.read();

    expect(first).toEqual({
      completedThrough: "2026-07-26T12:30:00.000Z",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it.each([
    ["empty", ""],
    ["whitespace", " \n"],
    ["invalid JSON", "{"],
    ["null", "null"],
    ["array", "[]"],
    ["raw string", '"2026-07-26T12:30:00.000Z"'],
    ["empty object", "{}"],
    ["missing version", '{"completedThrough":"2026-07-26T12:30:00.000Z"}'],
    [
      "unsupported version",
      '{"version":2,"completedThrough":"2026-07-26T12:30:00.000Z"}',
    ],
    ["missing cursor", '{"version":1}'],
    [
      "extra field",
      '{"version":1,"completedThrough":"2026-07-26T12:30:00.000Z","extra":true}',
    ],
    ["non-string cursor", '{"version":1,"completedThrough":123}'],
    [
      "non-canonical cursor",
      '{"version":1,"completedThrough":"2026-07-26T12:30:00Z"}',
    ],
    [
      "second-bearing cursor",
      '{"version":1,"completedThrough":"2026-07-26T12:30:01.000Z"}',
    ],
    [
      "offset cursor",
      '{"version":1,"completedThrough":"2026-07-26T09:30:00.000-03:00"}',
    ],
  ])("rejects %s persisted data safely", async (_description, contents) => {
    const { filePath } = await createTemporaryCursorPath();
    await writeFile(filePath, contents, "utf8");
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );

    await expect(store.read()).rejects.toMatchObject({
      name: "FileServiceAvailabilityReconciliationSchedulerCursorStoreError",
      code: "invalid_cursor_file",
      message:
        "File service availability reconciliation scheduler cursor store failed: invalid_cursor_file",
    });
  });

  it("rejects malformed UTF-8 as an invalid cursor file", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(Uint8Array.from([0xc3, 0x28]));
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    await expect(store.read()).rejects.toMatchObject({
      code: "invalid_cursor_file",
    });
  });

  it("converts native read failures into a frozen safe error", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(
      Object.assign(new Error("secret /trusted/cursor.json"), {
        code: "EACCES",
      }),
    );
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    try {
      await store.read();
    } catch (error) {
      expect(error).toBeInstanceOf(
        FileServiceAvailabilityReconciliationSchedulerCursorStoreError,
      );
      expect(error).toMatchObject({
        code: "cursor_read_failed",
        message:
          "File service availability reconciliation scheduler cursor store failed: cursor_read_failed",
      });
      expect(Object.isFrozen(error)).toBe(true);
      expect(error).not.toHaveProperty("cause");
      expect(JSON.stringify(error)).not.toContain("/trusted");
      expect((error as Error).message).not.toContain("secret");
      return;
    }

    throw new Error("Expected cursor read to fail");
  });

  it("persists an initial cursor through an owner-restricted atomic replacement", async () => {
    const { directory, filePath } = await createTemporaryCursorPath();
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );
    const next = createCursor("2026-07-26T12:30:00.000Z");

    const result = await store.advance(null, next);

    expect(result).toEqual({ kind: "advanced", cursor: next });
    expect(result.cursor).toBe(next);
    expect(Object.isFrozen(result)).toBe(true);
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"version":1,"completedThrough":"2026-07-26T12:30:00.000Z"}\n',
    );
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(readdir(directory)).resolves.toEqual(["cursor.json"]);
  });

  it("writes, flushes, closes, and renames in order with exact atomic arguments", async () => {
    const trace: string[] = [];
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    dependencies.createTemporaryPath.mockImplementation(() => {
      trace.push("temporary");
      return "/trusted/.cursor.json.test.tmp";
    });
    dependencies.open.mockImplementation((path, flags, mode) => {
      trace.push(`open:${path}:${flags}:${mode.toString(8)}`);
      return Promise.resolve({
        writeFile: vi.fn((contents) => {
          trace.push(`write:${contents}`);
          return Promise.resolve();
        }),
        sync: vi.fn(() => {
          trace.push("sync");
          return Promise.resolve();
        }),
        close: vi.fn(() => {
          trace.push("close");
          return Promise.resolve();
        }),
      });
    });
    dependencies.rename.mockImplementation((temporaryPath, filePath) => {
      trace.push(`rename:${temporaryPath}:${filePath}`);
      return Promise.resolve();
    });
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    await store.advance(null, createCursor("2026-07-26T12:30:00.000Z"));

    expect(trace).toEqual([
      "temporary",
      "open:/trusted/.cursor.json.test.tmp:wx:600",
      'write:{"version":1,"completedThrough":"2026-07-26T12:30:00.000Z"}\n',
      "sync",
      "close",
      "rename:/trusted/.cursor.json.test.tmp:/trusted/cursor.json",
    ]);
    expect(dependencies.unlink).not.toHaveBeenCalled();
  });

  it("supports sequential advancement and reconstruction by a new adapter", async () => {
    const { filePath } = await createTemporaryCursorPath();
    const firstStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(filePath);
    const first = createCursor("2026-07-26T12:30:00.000Z");
    const second = createCursor("2026-07-26T12:31:00.000Z");

    await firstStore.advance(null, first);
    const reconstructedExpected = createCursor(first.completedThrough);
    await firstStore.advance(reconstructedExpected, second);

    const reconstructedStore =
      new FileServiceAvailabilityReconciliationSchedulerCursorStore(filePath);
    await expect(reconstructedStore.read()).resolves.toEqual(second);
  });

  it("consults the file again after a valid external replacement", async () => {
    const { filePath } = await createTemporaryCursorPath();
    await writeCursorFile(filePath, "2026-07-26T12:30:00.000Z");
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );
    await expect(store.read()).resolves.toEqual({
      completedThrough: "2026-07-26T12:30:00.000Z",
    });

    await writeCursorFile(filePath, "2026-07-26T12:31:00.000Z");

    await expect(store.read()).resolves.toEqual({
      completedThrough: "2026-07-26T12:31:00.000Z",
    });
  });

  it("returns frozen conflicts without writing or validating forward movement", async () => {
    const { filePath } = await createTemporaryCursorPath();
    await writeCursorFile(filePath, "2026-07-26T12:30:00.000Z");
    const dependencies = createNodeDependencies();
    const openSpy = vi.spyOn(dependencies, "open");
    const renameSpy = vi.spyOn(dependencies, "rename");
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
      dependencies,
    );
    const stale = createCursor("2026-07-26T12:29:00.000Z");

    const result = await store.advance(stale, stale);

    expect(result.kind).toBe("conflict");
    expect(result.cursor).toEqual({
      completedThrough: "2026-07-26T12:30:00.000Z",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.cursor)).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
    expect(renameSpy).not.toHaveBeenCalled();
  });

  it("returns an empty-state conflict without creating a file", async () => {
    const { filePath } = await createTemporaryCursorPath();
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );
    const expected = createCursor("2026-07-26T12:30:00.000Z");

    await expect(store.advance(expected, expected)).resolves.toEqual({
      kind: "conflict",
      cursor: null,
    });
    await expect(stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["2026-07-26T12:30:00.000Z", "2026-07-26T12:29:00.000Z"])(
    "rejects non-forward advancement to %s without changing the target",
    async (nextTimestamp) => {
      const { filePath } = await createTemporaryCursorPath();
      await writeCursorFile(filePath, "2026-07-26T12:30:00.000Z");
      const store =
        new FileServiceAvailabilityReconciliationSchedulerCursorStore(filePath);
      const current = createCursor("2026-07-26T12:30:00.000Z");

      await expect(
        store.advance(current, createCursor(nextTimestamp)),
      ).rejects.toMatchObject({
        code: "non_forward_cursor",
      });
      await expect(readFile(filePath, "utf8")).resolves.toContain(
        "2026-07-26T12:30:00.000Z",
      );
    },
  );

  it("serializes concurrent compare-and-set operations within one instance", async () => {
    const { filePath } = await createTemporaryCursorPath();
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
    );
    const candidates = Array.from({ length: 20 }, (_, index) =>
      createCursor(
        new Date(
          Date.parse("2026-07-26T12:30:00.000Z") + index * 60_000,
        ).toISOString(),
      ),
    );

    const results = await Promise.all(
      candidates.map((candidate) => store.advance(null, candidate)),
    );

    expect(results.filter(({ kind }) => kind === "advanced")).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "conflict")).toHaveLength(19);
    expect(await store.read()).toEqual(results[0]?.cursor);
  });

  it("does not let later operations enter while an earlier read is pending", async () => {
    const dependencies = createControlledDependencies();
    const firstRead = createDeferred<Uint8Array>();
    dependencies.readFile
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValueOnce(encodeCursorFile("2026-07-26T12:30:00.000Z"));
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    const first = store.read();
    const second = store.read();

    await Promise.resolve();
    expect(dependencies.readFile).toHaveBeenCalledTimes(1);
    firstRead.resolve(encodeCursorFile("2026-07-26T12:29:00.000Z"));
    await first;
    await second;
    expect(dependencies.readFile).toHaveBeenCalledTimes(2);
  });

  it("recovers its operation queue after a failure", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile
      .mockRejectedValueOnce(
        Object.assign(new Error("denied"), { code: "EACCES" }),
      )
      .mockResolvedValueOnce(encodeCursorFile("2026-07-26T12:30:00.000Z"));
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    await expect(store.read()).rejects.toMatchObject({
      code: "cursor_read_failed",
    });
    await expect(store.read()).resolves.toEqual({
      completedThrough: "2026-07-26T12:30:00.000Z",
    });
  });

  it("preserves the previous target and cleans the temporary file after rename failure", async () => {
    const { directory, filePath } = await createTemporaryCursorPath();
    await writeCursorFile(filePath, "2026-07-26T12:30:00.000Z");
    const dependencies = {
      ...createNodeDependencies(),
      rename: vi.fn(() => Promise.reject(new Error("rename failed"))),
    };
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      filePath,
      dependencies,
    );
    const current = createCursor("2026-07-26T12:30:00.000Z");
    const next = createCursor("2026-07-26T12:31:00.000Z");

    await expect(store.advance(current, next)).rejects.toMatchObject({
      code: "cursor_write_failed",
    });

    await expect(readFile(filePath, "utf8")).resolves.toContain(
      current.completedThrough,
    );
    await expect(readdir(directory)).resolves.toEqual(["cursor.json"]);
  });

  it("keeps the primary safe write error when cleanup also fails", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" }),
    );
    dependencies.open.mockResolvedValue({
      writeFile: vi.fn(() =>
        Promise.reject(new Error("sensitive write failure")),
      ),
      sync: vi.fn(),
      close: vi.fn(),
    });
    dependencies.unlink.mockRejectedValue(
      new Error("sensitive cleanup failure"),
    );
    const store = new FileServiceAvailabilityReconciliationSchedulerCursorStore(
      "/trusted/cursor.json",
      dependencies,
    );

    await expect(
      store.advance(null, createCursor("2026-07-26T12:30:00.000Z")),
    ).rejects.toEqual(
      new FileServiceAvailabilityReconciliationSchedulerCursorStoreError(
        "cursor_write_failed",
      ),
    );
    expect(dependencies.unlink).toHaveBeenCalledOnce();
  });
});

function createCursor(
  completedThrough: string,
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough,
  });
}

async function createTemporaryCursorPath(): Promise<{
  directory: string;
  filePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-cursor-store-"));
  temporaryDirectories.push(directory);
  return { directory, filePath: join(directory, "cursor.json") };
}

async function writeCursorFile(
  filePath: string,
  completedThrough: string,
): Promise<void> {
  await writeFile(
    filePath,
    `${JSON.stringify({ version: 1, completedThrough })}\n`,
    "utf8",
  );
}

function encodeCursorFile(completedThrough: string): Uint8Array {
  return new TextEncoder().encode(
    `${JSON.stringify({ version: 1, completedThrough })}\n`,
  );
}

function createControlledDependencies() {
  return {
    readFile:
      vi.fn<
        FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies["readFile"]
      >(),
    open: vi.fn<
      FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies["open"]
    >(),
    rename:
      vi.fn<
        FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies["rename"]
      >(),
    unlink:
      vi.fn<
        FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies["unlink"]
      >(),
    createTemporaryPath: vi.fn<
      FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies["createTemporaryPath"]
    >(() => "/trusted/.cursor.json.test.tmp"),
  };
}

function createNodeDependencies(): FileServiceAvailabilityReconciliationSchedulerCursorStoreDependencies {
  return {
    readFile: (filePath) => readFile(filePath),
    open: (filePath, flags, mode) => open(filePath, flags, mode),
    rename,
    unlink,
    createTemporaryPath: (filePath) => `${filePath}.test.tmp`,
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}
