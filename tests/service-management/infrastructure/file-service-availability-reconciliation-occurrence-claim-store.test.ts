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

import { ServiceAvailabilityReconciliationOccurrence } from "../../../src/service-management/domain/service-availability-reconciliation-occurrence.js";
import { ServiceAvailabilityReconciliationSchedulerCursor } from "../../../src/service-management/domain/service-availability-reconciliation-scheduler-cursor.js";
import {
  FileServiceAvailabilityReconciliationOccurrenceClaimStore,
  FileServiceAvailabilityReconciliationOccurrenceClaimStoreError,
  type FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies,
} from "../../../src/service-management/infrastructure/file-service-availability-reconciliation-occurrence-claim-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("FileServiceAvailabilityReconciliationOccurrenceClaimStore", () => {
  it("is frozen, exposes only claim and pruning, and performs no construction work", () => {
    const dependencies = createControlledDependencies();

    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    expect(Object.isFrozen(store)).toBe(true);
    expect(Object.keys(store)).toEqual([]);
    expect(
      Object.getOwnPropertyNames(Object.getPrototypeOf(store) as object).sort(),
    ).toEqual(["claim", "constructor", "pruneCompletedThrough"]);
    expect(dependencies.readFile).not.toHaveBeenCalled();
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
    expect(dependencies.unlink).not.toHaveBeenCalled();
  });

  it("persists a first claim using an owner-restricted atomic replacement", async () => {
    const { directory, filePath } = await createTemporaryClaimPath();
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    const occurrence = createOccurrence();

    const result = await store.claim(occurrence);

    expect(result).toEqual({ kind: "claimed" });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"version":1,"claims":[{"serviceId":"api","operation":"start","scheduledFor":"2026-07-26T12:30:00.000Z"}]}\n',
    );
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    await expect(readdir(directory)).resolves.toEqual(["claims.json"]);
  });

  it("writes, flushes, closes, and renames in order with exact arguments", async () => {
    const trace: string[] = [];
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(missingFileError());
    dependencies.createTemporaryPath.mockImplementation(() => {
      trace.push("temporary");
      return "/trusted/.claims.test.tmp";
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
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    await store.claim(createOccurrence());

    expect(trace).toEqual([
      "temporary",
      "open:/trusted/.claims.test.tmp:wx:600",
      'write:{"version":1,"claims":[{"serviceId":"api","operation":"start","scheduledFor":"2026-07-26T12:30:00.000Z"}]}\n',
      "sync",
      "close",
      "rename:/trusted/.claims.test.tmp:/trusted/claims.json",
    ]);
    expect(dependencies.unlink).not.toHaveBeenCalled();
  });

  it("supports a valid explicitly empty claim file", async () => {
    const { filePath } = await createTemporaryClaimPath();
    await writeFile(filePath, '{"version":1,"claims":[]}\n', "utf8");
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );

    await expect(store.claim(createOccurrence())).resolves.toEqual({
      kind: "claimed",
    });
  });

  it("returns frozen unchanged for missing state without writing", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(missingFileError());
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    const result = await store.pruneCompletedThrough(createCursor());

    expect(result).toEqual({ kind: "unchanged" });
    expect(Object.keys(result)).toEqual(["kind"]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
  });

  it("returns unchanged for empty and future-only state without writing", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile
      .mockResolvedValueOnce(encodeClaimFile([]))
      .mockResolvedValueOnce(
        encodeClaimFile([
          persistedClaim({ scheduledFor: "2026-07-26T12:31:00.000Z" }),
        ]),
      );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    await expect(store.pruneCompletedThrough(createCursor())).resolves.toEqual({
      kind: "unchanged",
    });
    await expect(store.pruneCompletedThrough(createCursor())).resolves.toEqual({
      kind: "unchanged",
    });
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
  });

  it("prunes claims before and at the inclusive cursor boundary while preserving future claims", async () => {
    const { filePath } = await createTemporaryClaimPath();
    await writeFile(
      filePath,
      claimFile([
        persistedClaim({ scheduledFor: "2026-07-26T12:29:00.000Z" }),
        persistedClaim(),
        persistedClaim({
          serviceId: "web",
          operation: "stop",
          scheduledFor: "2026-07-26T12:31:00.000Z",
        }),
      ]),
      "utf8",
    );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    const cursor = createCursor();
    const cursorSnapshot = { ...cursor };

    const result = await store.pruneCompletedThrough(cursor);

    expect(result).toEqual({ kind: "pruned" });
    expect(Object.isFrozen(result)).toBe(true);
    await expect(readPersistedClaims(filePath)).resolves.toEqual([
      persistedClaim({
        serviceId: "web",
        operation: "stop",
        scheduledFor: "2026-07-26T12:31:00.000Z",
      }),
    ]);
    expect(cursor).toEqual(cursorSnapshot);
  });

  it("persists the canonical empty file when every claim is pruned", async () => {
    const { filePath } = await createTemporaryClaimPath();
    await writeFile(filePath, claimFile([persistedClaim()]), "utf8");
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );

    await expect(store.pruneCompletedThrough(createCursor())).resolves.toEqual({
      kind: "pruned",
    });
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      '{"version":1,"claims":[]}\n',
    );
    await expect(store.pruneCompletedThrough(createCursor())).resolves.toEqual({
      kind: "unchanged",
    });
  });

  it("uses authoritative externally replaced state for pruning", async () => {
    const { filePath } = await createTemporaryClaimPath();
    await writeFile(
      filePath,
      claimFile([persistedClaim({ scheduledFor: "2026-07-26T12:31:00.000Z" })]),
      "utf8",
    );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    await expect(store.pruneCompletedThrough(createCursor())).resolves.toEqual({
      kind: "unchanged",
    });

    await writeFile(filePath, claimFile([persistedClaim()]), "utf8");

    await expect(store.pruneCompletedThrough(createCursor())).resolves.toEqual({
      kind: "pruned",
    });
    await expect(readPersistedClaims(filePath)).resolves.toEqual([]);
  });

  it("preserves invalid-file errors during pruning", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(new TextEncoder().encode("{"));
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    await expect(
      store.pruneCompletedThrough(createCursor()),
    ).rejects.toMatchObject({
      code: "invalid_claim_file",
    });
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
  });

  it("serializes claim and pruning in invocation order without a watermark", async () => {
    const firstPath = await createTemporaryClaimPath();
    const claimThenPrune =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
        firstPath.filePath,
      );

    const claimResult = claimThenPrune.claim(createOccurrence());
    const pruningResult = claimThenPrune.pruneCompletedThrough(createCursor());

    await expect(claimResult).resolves.toEqual({ kind: "claimed" });
    await expect(pruningResult).resolves.toEqual({ kind: "pruned" });
    await expect(readPersistedClaims(firstPath.filePath)).resolves.toEqual([]);

    const secondPath = await createTemporaryClaimPath();
    const pruneThenClaim =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
        secondPath.filePath,
      );

    const unchangedResult =
      pruneThenClaim.pruneCompletedThrough(createCursor());
    const laterClaimResult = pruneThenClaim.claim(createOccurrence());

    await expect(unchangedResult).resolves.toEqual({ kind: "unchanged" });
    await expect(laterClaimResult).resolves.toEqual({ kind: "claimed" });
    await expect(readPersistedClaims(secondPath.filePath)).resolves.toEqual([
      persistedClaim(),
    ]);
  });

  it("rejects pruning write failure safely and preserves the previous target", async () => {
    const { directory, filePath } = await createTemporaryClaimPath();
    const originalContents = claimFile([persistedClaim()]);
    await writeFile(filePath, originalContents, "utf8");
    const dependencies = createNodeDependencies();
    dependencies.rename.mockRejectedValue(new Error("secret rename failure"));
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
      dependencies,
    );

    const error = await captureError(() =>
      store.pruneCompletedThrough(createCursor()),
    );

    expect(error).toMatchObject({ code: "claim_write_failed" });
    expect(String(error)).not.toContain(filePath);
    expect(String(error)).not.toContain(createCursor().completedThrough);
    await expect(readFile(filePath, "utf8")).resolves.toBe(originalContents);
    await expect(readdir(directory)).resolves.toEqual(["claims.json"]);
  });

  it("returns a frozen duplicate without writing", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(
      encodeClaimFile([persistedClaim()]),
    );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    const result = await store.claim(createOccurrence());

    expect(result).toEqual({ kind: "duplicate" });
    expect(Object.isFrozen(result)).toBe(true);
    expect(dependencies.createTemporaryPath).not.toHaveBeenCalled();
    expect(dependencies.open).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
  });

  it("preserves existing claims and writes the complete set in canonical order", async () => {
    const { filePath } = await createTemporaryClaimPath();
    await writeFile(
      filePath,
      claimFile([
        persistedClaim({
          serviceId: "web",
          operation: "stop",
          scheduledFor: "2026-07-26T12:31:00.000Z",
        }),
      ]),
      "utf8",
    );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );

    await store.claim(
      createOccurrence({
        serviceId: "api",
        scheduledFor: "2026-07-26T12:30:00.000Z",
      }),
    );

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      claims: [
        persistedClaim(),
        persistedClaim({
          serviceId: "web",
          operation: "stop",
          scheduledFor: "2026-07-26T12:31:00.000Z",
        }),
      ],
    });
  });

  it.each([
    ["zero-byte", ""],
    ["whitespace", " \n"],
    ["invalid UTF-8", Uint8Array.from([0xc3, 0x28])],
    ["invalid JSON", "{"],
    ["null", "null"],
    ["top-level array", "[]"],
    ["raw occurrence", JSON.stringify(persistedClaim())],
    ["raw occurrence array", JSON.stringify([persistedClaim()])],
    ["missing version", JSON.stringify({ claims: [] })],
    ["unsupported version", JSON.stringify({ version: 2, claims: [] })],
    ["missing claims", JSON.stringify({ version: 1 })],
    ["extra top-level field", JSON.stringify({ version: 1, claims: [], x: 1 })],
    ["non-array claims", JSON.stringify({ version: 1, claims: {} })],
    ["non-object claim", claimFile(["claim"])],
    [
      "missing claim field",
      claimFile([{ serviceId: "api", operation: "start" }]),
    ],
    ["extra claim field", claimFile([{ ...persistedClaim(), extra: true }])],
    ["invalid service ID", claimFile([persistedClaim({ serviceId: "API" })])],
    [
      "invalid operation",
      claimFile([persistedClaim({ operation: "restart" })]),
    ],
    [
      "invalid timestamp",
      claimFile([persistedClaim({ scheduledFor: "2026-07-26T12:30:00Z" })]),
    ],
    ["duplicate occurrences", claimFile([persistedClaim(), persistedClaim()])],
    [
      "out-of-order occurrences",
      claimFile([
        persistedClaim({
          serviceId: "web",
          scheduledFor: "2026-07-26T12:31:00.000Z",
        }),
        persistedClaim(),
      ]),
    ],
  ])("rejects %s persisted data safely", async (_description, contents) => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockResolvedValue(
      typeof contents === "string"
        ? new TextEncoder().encode(contents)
        : contents,
    );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    await expect(store.claim(createOccurrence())).rejects.toMatchObject({
      name: "FileServiceAvailabilityReconciliationOccurrenceClaimStoreError",
      code: "invalid_claim_file",
      message:
        "File service availability reconciliation occurrence claim store failed: invalid_claim_file",
    });
    expect(dependencies.open).not.toHaveBeenCalled();
  });

  it("converts native read failures into a frozen safe error", async () => {
    const dependencies = createControlledDependencies();
    dependencies.readFile.mockRejectedValue(
      Object.assign(new Error("secret /trusted/claims.json"), {
        code: "EACCES",
      }),
    );
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    const error = await captureError(() => store.claim(createOccurrence()));

    expect(error).toBeInstanceOf(
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreError,
    );
    expect(error).toMatchObject({
      code: "claim_read_failed",
      message:
        "File service availability reconciliation occurrence claim store failed: claim_read_failed",
    });
    expect(Object.isFrozen(error)).toBe(true);
    expect(error).not.toHaveProperty("cause");
    expect(JSON.stringify(error)).not.toContain("/trusted");
    expect((error as Error).message).not.toContain("secret");
  });

  it("serializes equivalent concurrent claims so exactly one is claimed", async () => {
    const { filePath } = await createTemporaryClaimPath();
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    const occurrence = createOccurrence();

    const results = await Promise.all(
      Array.from({ length: 6 }, () => store.claim(occurrence)),
    );

    expect(results.filter(({ kind }) => kind === "claimed")).toHaveLength(1);
    expect(results.filter(({ kind }) => kind === "duplicate")).toHaveLength(5);
    expect(await readPersistedClaims(filePath)).toEqual([persistedClaim()]);
  });

  it("serializes distinct concurrent claims without losing updates", async () => {
    const { filePath } = await createTemporaryClaimPath();
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    const occurrences = [
      createOccurrence({
        serviceId: "web",
        operation: "stop",
        scheduledFor: "2026-07-26T12:31:00.000Z",
      }),
      createOccurrence(),
      createOccurrence({
        serviceId: "api",
        operation: "stop",
        scheduledFor: "2026-07-26T12:30:00.000Z",
      }),
    ];

    const results = await Promise.all(
      occurrences.map((occurrence) => store.claim(occurrence)),
    );

    expect(results).toEqual([
      { kind: "claimed" },
      { kind: "claimed" },
      { kind: "claimed" },
    ]);
    expect(await readPersistedClaims(filePath)).toEqual([
      persistedClaim(),
      persistedClaim({ operation: "stop" }),
      persistedClaim({
        serviceId: "web",
        operation: "stop",
        scheduledFor: "2026-07-26T12:31:00.000Z",
      }),
    ]);
  });

  it("does not start a later claim until the current operation settles", async () => {
    const dependencies = createControlledDependencies();
    const firstRead = deferred<Uint8Array>();
    dependencies.readFile
      .mockImplementationOnce(() => firstRead.promise)
      .mockRejectedValue(missingFileError());
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    const first = store.claim(createOccurrence());
    const second = store.claim(
      createOccurrence({ serviceId: "web", operation: "stop" }),
    );
    await Promise.resolve();

    expect(dependencies.readFile).toHaveBeenCalledTimes(1);
    firstRead.resolve(encodeClaimFile([persistedClaim()]));
    await first;
    await second;

    expect(dependencies.readFile).toHaveBeenCalledTimes(2);
  });

  it("recovers its operation queue after a failed claim", async () => {
    const { filePath } = await createTemporaryClaimPath();
    const dependencies = createNodeDependencies();
    dependencies.readFile
      .mockRejectedValueOnce(
        Object.assign(new Error("denied"), { code: "EACCES" }),
      )
      .mockRejectedValueOnce(missingFileError());
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
      dependencies,
    );

    await expect(store.claim(createOccurrence())).rejects.toMatchObject({
      code: "claim_read_failed",
    });
    await expect(
      store.claim(createOccurrence({ serviceId: "web" })),
    ).resolves.toEqual({ kind: "claimed" });
  });

  it("preserves duplicate detection across adapter reconstruction", async () => {
    const { filePath } = await createTemporaryClaimPath();
    const first = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    await first.claim(createOccurrence());

    const reconstructed =
      new FileServiceAvailabilityReconciliationOccurrenceClaimStore(filePath);

    await expect(reconstructed.claim(createOccurrence())).resolves.toEqual({
      kind: "duplicate",
    });
    await expect(
      reconstructed.claim(createOccurrence({ serviceId: "web" })),
    ).resolves.toEqual({ kind: "claimed" });
    expect(await readPersistedClaims(filePath)).toHaveLength(2);
  });

  it("observes a later valid external file replacement", async () => {
    const { filePath } = await createTemporaryClaimPath();
    await writeFile(filePath, claimFile([persistedClaim()]), "utf8");
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
    );
    await expect(store.claim(createOccurrence())).resolves.toEqual({
      kind: "duplicate",
    });
    await writeFile(
      filePath,
      claimFile([persistedClaim({ serviceId: "web" })]),
      "utf8",
    );

    await expect(store.claim(createOccurrence())).resolves.toEqual({
      kind: "claimed",
    });
  });

  it.each([
    ["the target path", "/trusted/claims.json"],
    ["another directory", "/other/.claims.tmp"],
  ])(
    "rejects a temporary path in %s before opening it",
    async (_case, path) => {
      const dependencies = createControlledDependencies();
      dependencies.readFile.mockRejectedValue(missingFileError());
      dependencies.createTemporaryPath.mockReturnValue(path);
      const store =
        new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
          "/trusted/claims.json",
          dependencies,
        );

      await expect(store.claim(createOccurrence())).rejects.toMatchObject({
        code: "claim_write_failed",
      });
      expect(dependencies.open).not.toHaveBeenCalled();
      expect(dependencies.rename).not.toHaveBeenCalled();
    },
  );

  it("preserves the previous target and cleans the temporary file after rename failure", async () => {
    const { directory, filePath } = await createTemporaryClaimPath();
    await writeFile(filePath, claimFile([persistedClaim()]), "utf8");
    const temporaryPath = join(directory, ".claims.test.tmp");
    const dependencies = createNodeDependencies();
    dependencies.createTemporaryPath.mockReturnValue(temporaryPath);
    dependencies.rename.mockRejectedValue(new Error("secret rename failure"));
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      filePath,
      dependencies,
    );

    const error = await captureError(() =>
      store.claim(createOccurrence({ serviceId: "web" })),
    );

    expect(error).toMatchObject({ code: "claim_write_failed" });
    expect(Object.isFrozen(error)).toBe(true);
    expect((error as Error).message).not.toContain("secret");
    await expect(readFile(filePath, "utf8")).resolves.toBe(
      claimFile([persistedClaim()]),
    );
    await expect(readdir(directory)).resolves.toEqual(["claims.json"]);
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
    const store = new FileServiceAvailabilityReconciliationOccurrenceClaimStore(
      "/trusted/claims.json",
      dependencies,
    );

    const error = await captureError(() => store.claim(createOccurrence()));

    expect(error).toMatchObject({
      code: "claim_write_failed",
      message:
        "File service availability reconciliation occurrence claim store failed: claim_write_failed",
    });
    expect(handle.close).toHaveBeenCalledOnce();
    expect(dependencies.unlink).toHaveBeenCalledOnce();
    expect(dependencies.rename).not.toHaveBeenCalled();
  });
});

function createOccurrence(
  overrides: Partial<{
    serviceId: string;
    operation: string;
    scheduledFor: string;
  }> = {},
): ServiceAvailabilityReconciliationOccurrence {
  return ServiceAvailabilityReconciliationOccurrence.create({
    serviceId: "api",
    operation: "start",
    scheduledFor: "2026-07-26T12:30:00.000Z",
    ...overrides,
  });
}

function createCursor(
  completedThrough = "2026-07-26T12:30:00.000Z",
): ServiceAvailabilityReconciliationSchedulerCursor {
  return ServiceAvailabilityReconciliationSchedulerCursor.create({
    completedThrough,
  });
}

function persistedClaim(
  overrides: Partial<{
    serviceId: string;
    operation: string;
    scheduledFor: string;
  }> = {},
): Readonly<Record<string, unknown>> {
  return {
    serviceId: "api",
    operation: "start",
    scheduledFor: "2026-07-26T12:30:00.000Z",
    ...overrides,
  };
}

function claimFile(claims: readonly unknown[]): string {
  return `${JSON.stringify({ version: 1, claims })}\n`;
}

function encodeClaimFile(claims: readonly unknown[]): Uint8Array {
  return new TextEncoder().encode(claimFile(claims));
}

async function createTemporaryClaimPath(): Promise<{
  directory: string;
  filePath: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), "atlas-claims-"));
  temporaryDirectories.push(directory);
  return { directory, filePath: join(directory, "claims.json") };
}

async function readPersistedClaims(filePath: string): Promise<unknown[]> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as {
    claims: unknown[];
  };
  return parsed.claims;
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
      vi.fn<
        FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["readFile"]
      >(),
    open: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["open"]
    >(() => Promise.resolve(handle)),
    rename: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["rename"]
    >(() => Promise.resolve()),
    unlink: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["unlink"]
    >(() => Promise.resolve()),
    createTemporaryPath: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["createTemporaryPath"]
    >(() => "/trusted/.claims.test.tmp"),
  };
}

function createNodeDependencies() {
  return {
    readFile: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["readFile"]
    >((filePath) => readFile(filePath)),
    open: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["open"]
    >((filePath, flags, mode) => open(filePath, flags, mode)),
    rename:
      vi.fn<
        FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["rename"]
      >(rename),
    unlink:
      vi.fn<
        FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["unlink"]
      >(unlink),
    createTemporaryPath: vi.fn<
      FileServiceAvailabilityReconciliationOccurrenceClaimStoreDependencies["createTemporaryPath"]
    >((filePath) => join(dirname(filePath), ".claims.test.tmp")),
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
