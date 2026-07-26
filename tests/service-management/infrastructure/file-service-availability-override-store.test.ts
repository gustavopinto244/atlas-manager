import {
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FileServiceAvailabilityOverrideStore,
  FileServiceAvailabilityOverrideStoreError,
  type FileServiceAvailabilityOverrideStoreDependencies,
} from "../../../src/service-management/infrastructure/file-service-availability-override-store.js";
import {
  createServiceAvailabilityOverride,
  type ServiceAvailabilityOverride,
} from "../../../src/service-scheduling/domain/service-availability-override.js";

const temporaryDirectories: string[] = [];
const creationInstant = new Date("2026-07-26T10:00:00.000Z");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileServiceAvailabilityOverrideStore", () => {
  it("is frozen, exposes only the port API, and performs no construction work", () => {
    const dependencies = createControlledDependencies();

    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    expect(Object.isFrozen(store)).toBe(true);
    expect(Object.keys(store)).toEqual([]);
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(store) as object).sort(),
    ).toEqual(
      ["constructor", "findByServiceId", "removeByServiceId", "save"].sort(),
    );
    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
    expect(dependencies.unlink).not.toHaveBeenCalled();
  });

  it("treats a missing target as empty without creating a file", async () => {
    const { directory, filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    await expect(store.findByServiceId("api")).resolves.toBeNull();
    await expect(store.removeByServiceId("api")).resolves.toBeUndefined();
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it("supports a valid explicit empty version-one file", async () => {
    const { filePath } = await createTemporaryOverridePath();
    await writeFile(filePath, '{"version":1,"overrides":[]}\n', "utf8");
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    await expect(store.findByServiceId("api")).resolves.toBeNull();
    await expect(store.save("api", createOverride())).resolves.toBeUndefined();
    await expect(store.findByServiceId("api")).resolves.toEqual(
      createOverride(),
    );
  });

  it("reconstructs canonical overrides and preserves expired values", async () => {
    const { filePath } = await createTemporaryOverridePath();
    await writeFile(
      filePath,
      overrideFile([
        persistedOverride({
          expiresAt: "2000-01-01T00:00:00.000Z",
        }),
      ]),
      "utf8",
    );
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    const first = await store.findByServiceId("api");
    const second = await store.findByServiceId("api");

    expect(first).toEqual({
      kind: "keep_available",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    expect(Object.isFrozen(first)).toBe(true);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it.each([
    ["zero-byte", ""],
    ["whitespace", " \n"],
    ["invalid UTF-8", Uint8Array.from([0xc3, 0x28])],
    ["invalid JSON", "{"],
    ["null", "null"],
    ["top-level array", "[]"],
    ["empty object", "{}"],
    ["raw override array", JSON.stringify([persistedOverride()])],
    ["raw override", JSON.stringify(persistedOverride())],
    ["missing version", JSON.stringify({ overrides: [] })],
    ["unsupported version", JSON.stringify({ version: 2, overrides: [] })],
    ["missing overrides", JSON.stringify({ version: 1 })],
    [
      "extra top-level field",
      JSON.stringify({ version: 1, overrides: [], extra: true }),
    ],
    ["non-array overrides", JSON.stringify({ version: 1, overrides: {} })],
    ["non-object entry", overrideFile(["override"])],
    [
      "missing entry field",
      overrideFile([{ serviceId: "api", kind: "keep_available" }]),
    ],
    [
      "extra entry field",
      overrideFile([{ ...persistedOverride(), extra: true }]),
    ],
    [
      "non-string service ID",
      overrideFile([persistedOverride({ serviceId: 123 })]),
    ],
    ["invalid kind", overrideFile([persistedOverride({ kind: "always" })])],
    [
      "non-string expiration",
      overrideFile([persistedOverride({ expiresAt: 123 })]),
    ],
    [
      "non-canonical expiration",
      overrideFile([persistedOverride({ expiresAt: "2026-07-26T12:00:00Z" })]),
    ],
    [
      "duplicate service IDs",
      overrideFile([
        persistedOverride(),
        persistedOverride({ kind: "suspend_schedule" }),
      ]),
    ],
    [
      "out-of-order service IDs",
      overrideFile([
        persistedOverride({ serviceId: "web" }),
        persistedOverride({ serviceId: "api" }),
      ]),
    ],
  ])("rejects %s persisted state safely", async (_description, contents) => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(
      typeof contents === "string"
        ? new TextEncoder().encode(contents)
        : contents,
    );
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    await expect(store.findByServiceId("api")).rejects.toMatchObject({
      name: "FileServiceAvailabilityOverrideStoreError",
      code: "invalid_override_file",
      message:
        "File service availability override store failed: invalid_override_file",
    });
    expect(dependencies.open).not.toHaveBeenCalled();
  });

  it("converts native read failures into a frozen safe error", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(
      Object.assign(new Error("secret /trusted/overrides.json"), {
        code: "EACCES",
      }),
    );
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    const error = await captureError(() => store.findByServiceId("secret-api"));

    expect(error).toBeInstanceOf(FileServiceAvailabilityOverrideStoreError);
    expect(error).toMatchObject({
      code: "override_read_failed",
      message:
        "File service availability override store failed: override_read_failed",
    });
    expect(Object.isFrozen(error)).toBe(true);
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("/trusted");
    expect((error as Error).message).not.toContain("secret");
  });

  it("persists a first override through an owner-restricted atomic replacement", async () => {
    const { directory, filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);
    const override = createOverride();

    await expect(store.save("api", override)).resolves.toBeUndefined();

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"version":1,"overrides":[{"serviceId":"api","kind":"keep_available","expiresAt":"2026-07-26T12:00:00.000Z"}]}\n',
    );
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(readdir(directory)).resolves.toEqual(["overrides.json"]);
    expect(override).toEqual(createOverride());
  });

  it("writes, flushes, closes, and renames in order with exact arguments", async () => {
    const trace: string[] = [];
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(missingFileError());
    dependencies.createTemporaryPath.mockImplementation(() => {
      trace.push("temporary");
      return "/trusted/.overrides.test.tmp";
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
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    await store.save("api", createOverride());

    expect(trace).toEqual([
      "temporary",
      "open:/trusted/.overrides.test.tmp:wx:600",
      'write:{"version":1,"overrides":[{"serviceId":"api","kind":"keep_available","expiresAt":"2026-07-26T12:00:00.000Z"}]}\n',
      "sync",
      "close",
      "rename:/trusted/.overrides.test.tmp:/trusted/overrides.json",
    ]);
    expect(dependencies.unlink).not.toHaveBeenCalled();
  });

  it("preserves unrelated services and canonical order when setting", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    await store.save(
      "web",
      createOverride("suspend_schedule", "2026-07-26T13:00:00.000Z"),
    );
    await store.save("api", createOverride());

    expect(await readPersistedOverrides(filePath)).toEqual([
      persistedOverride(),
      persistedOverride({
        serviceId: "web",
        kind: "suspend_schedule",
        expiresAt: "2026-07-26T13:00:00.000Z",
      }),
    ]);
  });

  it("replaces only the matching service and treats equivalent save as replacement", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const dependencies = createNodeDependencies();
    const store = new FileServiceAvailabilityOverrideStore(
      filePath,
      dependencies,
    );
    const first = createOverride();
    const replacement = createOverride(
      "suspend_schedule",
      "2026-07-26T14:00:00.000Z",
    );

    await store.save("api", first);
    await store.save("web", createOverride());
    await store.save("api", replacement);
    await store.save("api", replacement);

    expect(await readPersistedOverrides(filePath)).toEqual([
      persistedOverride({
        kind: "suspend_schedule",
        expiresAt: "2026-07-26T14:00:00.000Z",
      }),
      persistedOverride({ serviceId: "web" }),
    ]);
    expect(dependencies.rename).toHaveBeenCalledTimes(4);
  });

  it("cancels only the selected override using atomic replacement", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);
    await store.save("api", createOverride());
    await store.save("web", createOverride("suspend_schedule"));

    await expect(store.removeByServiceId("api")).resolves.toBeUndefined();

    expect(await readPersistedOverrides(filePath)).toEqual([
      persistedOverride({ serviceId: "web", kind: "suspend_schedule" }),
    ]);
  });

  it("does not write when cancelling an absent override", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(
      encodeOverrideFile([persistedOverride()]),
    );
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    await expect(store.removeByServiceId("web")).resolves.toBeUndefined();

    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
  });

  it("persists a valid empty file when cancelling the final override", async () => {
    const { filePath } = await createTemporaryOverridePath();
    await writeFile(filePath, overrideFile([persistedOverride()]), "utf8");
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    await store.removeByServiceId("api");

    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"version":1,"overrides":[]}\n',
    );
  });

  it("serializes concurrent distinct saves without losing updates", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    await Promise.all([
      store.save("web", createOverride("suspend_schedule")),
      store.save("api", createOverride()),
      store.save(
        "database",
        createOverride("keep_available", "2026-07-26T14:00:00.000Z"),
      ),
    ]);

    expect(await readPersistedOverrides(filePath)).toEqual([
      persistedOverride(),
      persistedOverride({
        serviceId: "database",
        expiresAt: "2026-07-26T14:00:00.000Z",
      }),
      persistedOverride({ serviceId: "web", kind: "suspend_schedule" }),
    ]);
  });

  it("applies concurrent same-service replacements in queue order", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);
    const first = createOverride();
    const second = createOverride(
      "suspend_schedule",
      "2026-07-26T13:00:00.000Z",
    );
    const third = createOverride("keep_available", "2026-07-26T14:00:00.000Z");

    await Promise.all([
      store.save("api", first),
      store.save("api", second),
      store.save("api", third),
    ]);

    await expect(store.findByServiceId("api")).resolves.toEqual(third);
  });

  it("serializes a concurrent set followed by cancellation", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const store = new FileServiceAvailabilityOverrideStore(filePath);

    await Promise.all([
      store.save("api", createOverride()),
      store.removeByServiceId("api"),
    ]);

    await expect(store.findByServiceId("api")).resolves.toBeNull();
  });

  it("does not enter a later operation until the current read settles", async () => {
    const dependencies = createControlledDependencies();
    const firstRead = deferred<Uint8Array>();
    dependencies.readFile
      .mockImplementationOnce(() => firstRead.promise)
      .mockResolvedValue(encodeOverrideFile([]));
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    const first = store.findByServiceId("api");
    const second = store.findByServiceId("web");
    await Promise.resolve();

    expect(dependencies.readFile).toHaveBeenCalledTimes(1);
    firstRead.resolve(encodeOverrideFile([]));
    await first;
    await second;

    expect(dependencies.readFile).toHaveBeenCalledTimes(2);
  });

  it("recovers its operation queue after a failed operation", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const dependencies = createNodeDependencies();
    dependencies.readFile
      .mockRejectedValueOnce(
        Object.assign(new Error("denied"), { code: "EACCES" }),
      )
      .mockRejectedValueOnce(missingFileError());
    const store = new FileServiceAvailabilityOverrideStore(
      filePath,
      dependencies,
    );

    await expect(store.save("api", createOverride())).rejects.toMatchObject({
      code: "override_read_failed",
    });
    await expect(store.save("web", createOverride())).resolves.toBeUndefined();
  });

  it.each([
    ["the target path", "/trusted/overrides.json"],
    ["another directory", "/other/.overrides.tmp"],
  ])(
    "rejects a temporary path in %s before opening it",
    async (_case, path) => {
      const dependencies = createControlledDependencies();
      dependencies.readFile.mockRejectedValue(missingFileError());
      dependencies.createTemporaryPath.mockReturnValue(path);
      const store = new FileServiceAvailabilityOverrideStore(
        "/trusted/overrides.json",
        dependencies,
      );

      await expect(store.save("api", createOverride())).rejects.toMatchObject({
        code: "override_write_failed",
      });
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.rename).not.toHaveBeenCalled();
    },
  );

  it("preserves the previous target and cleans temporary state after rename failure", async () => {
    const { directory, filePath } = await createTemporaryOverridePath();
    await writeFile(filePath, overrideFile([persistedOverride()]), "utf8");
    const temporaryPath = join(directory, ".overrides.test.tmp");
    const dependencies = createNodeDependencies();
    dependencies.createTemporaryPath.mockReturnValue(temporaryPath);
    dependencies.rename.mockRejectedValue(new Error("secret rename failure"));
    const store = new FileServiceAvailabilityOverrideStore(
      filePath,
      dependencies,
    );

    const error = await captureError(() =>
      store.save("web", createOverride("suspend_schedule")),
    );

    expect(error).toMatchObject({ code: "override_write_failed" });
    expect(Object.isFrozen(error)).toBe(true);
    expect((error as Error).message).not.toContain("secret");
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      overrideFile([persistedOverride()]),
    );
    await expect(readdir(directory)).resolves.toEqual(["overrides.json"]);
    expect(dependencies.unlink).toHaveBeenCalledWith(temporaryPath);
  });

  it("keeps the primary safe write error when cleanup also fails", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(missingFileError());
    const handle = createControlledHandle();
    handle.writeFile.mockRejectedValue(new Error("secret write"));
    handle.close.mockRejectedValue(new Error("secret close"));
    dependencies.open.mockResolvedValue(handle);
    dependencies.unlink.mockRejectedValue(new Error("secret unlink"));
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    const error = await captureError(() =>
      store.save("secret-api", createOverride()),
    );

    expect(error).toMatchObject({
      code: "override_write_failed",
      message:
        "File service availability override store failed: override_write_failed",
    });
    expect(handle.close).toHaveBeenCalledOnce();
    expect(dependencies.unlink).toHaveBeenCalledOnce();
    expect(dependencies.rename).not.toHaveBeenCalled();
    expect(JSON.stringify(error)).not.toContain("secret-api");
  });

  it("preserves state across reconstruction and observes external replacement", async () => {
    const { filePath } = await createTemporaryOverridePath();
    const first = new FileServiceAvailabilityOverrideStore(filePath);
    await first.save("api", createOverride());

    const reconstructed = new FileServiceAvailabilityOverrideStore(filePath);
    await expect(reconstructed.findByServiceId("api")).resolves.toEqual(
      createOverride(),
    );
    await writeFile(
      filePath,
      overrideFile([
        persistedOverride({
          serviceId: "web",
          kind: "suspend_schedule",
        }),
      ]),
      "utf8",
    );

    await expect(reconstructed.findByServiceId("api")).resolves.toBeNull();
    await expect(reconstructed.findByServiceId("web")).resolves.toEqual(
      createOverride("suspend_schedule"),
    );
  });

  it("does not use time to interpret or prune persisted expiration", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(
      encodeOverrideFile([
        persistedOverride({ expiresAt: "2000-01-01T00:00:00.000Z" }),
      ]),
    );
    const dateNowSpy = vi.spyOn(Date, "now");
    const store = new FileServiceAvailabilityOverrideStore(
      "/trusted/overrides.json",
      dependencies,
    );

    try {
      await expect(store.findByServiceId("api")).resolves.toEqual({
        kind: "keep_available",
        expiresAt: "2000-01-01T00:00:00.000Z",
      });
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(dependencies.open).not.toHaveBeenCalled();
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});

function createOverride(
  kind: "keep_available" | "suspend_schedule" = "keep_available",
  expiresAt = "2026-07-26T12:00:00.000Z",
): ServiceAvailabilityOverride {
  return createServiceAvailabilityOverride(
    { kind, expiresAt },
    creationInstant,
  );
}

function persistedOverride(
  overrides: Partial<{
    serviceId: unknown;
    kind: unknown;
    expiresAt: unknown;
  }> = {},
): Readonly<Record<string, unknown>> {
  return {
    serviceId: "api",
    kind: "keep_available",
    expiresAt: "2026-07-26T12:00:00.000Z",
    ...overrides,
  };
}

function overrideFile(overrides: readonly unknown[]): string {
  return `${JSON.stringify({ version: 1, overrides })}\n`;
}

function encodeOverrideFile(overrides: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(overrideFile(overrides));
}

async function readPersistedOverrides(filePath: string): Promise<unknown[]> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
    overrides: unknown[];
  };
  return parsed.overrides;
}

async function createTemporaryOverridePath(): Promise<{
  directory: string;
  filePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-overrides-"));
  temporaryDirectories.push(directory);
  return { directory, filePath: join(directory, "overrides.json") };
}

function missingFileError(): Error & { code: string } {
  return Object.assign(new Error("missing"), { code: "ENOENT" });
}

function createControlledHandle() {
  return {
    writeFile: vi.fn(() => Promise.resolve()),
    sync: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };
}

function createControlledDependencies() {
  const handle = createControlledHandle();

  return {
    readFile:
      vi.fn<FileServiceAvailabilityOverrideStoreDependencies["readFile"]>(),
    open: vi.fn<FileServiceAvailabilityOverrideStoreDependencies["open"]>(() =>
      Promise.resolve(handle),
    ),
    rename: vi.fn<FileServiceAvailabilityOverrideStoreDependencies["rename"]>(
      () => Promise.resolve(),
    ),
    unlink: vi.fn<FileServiceAvailabilityOverrideStoreDependencies["unlink"]>(
      () => Promise.resolve(),
    ),
    createTemporaryPath: vi.fn<
      FileServiceAvailabilityOverrideStoreDependencies["createTemporaryPath"]
    >(() => "/trusted/.overrides.test.tmp"),
  };
}

function createNodeDependencies() {
  return {
    readFile: vi.fn<
      FileServiceAvailabilityOverrideStoreDependencies["readFile"]
    >((filePath) => readFile(filePath)),
    open: vi.fn<FileServiceAvailabilityOverrideStoreDependencies["open"]>(
      (filePath, flags, mode) => open(filePath, flags, mode),
    ),
    rename:
      vi.fn<FileServiceAvailabilityOverrideStoreDependencies["rename"]>(rename),
    unlink:
      vi.fn<FileServiceAvailabilityOverrideStoreDependencies["unlink"]>(unlink),
    createTemporaryPath: vi.fn<
      FileServiceAvailabilityOverrideStoreDependencies["createTemporaryPath"]
    >((filePath) => join(dirname(filePath), ".overrides.test.tmp")),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function captureError(
  operation: () => Promise<unknown>,
): Promise<unknown> {
  try {
    await operation();
  } catch (error: unknown) {
    return error;
  }

  throw new Error("Expected operation to fail");
}
