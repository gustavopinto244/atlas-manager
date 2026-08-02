import { describe, expect, it } from "vitest";
import { createBackupTarget } from "../../../src/backup-management/domain/backup-target.js";

const limits = {
  maxFiles: 10,
  maxTotalBytes: 1024,
  maxFileBytes: 512,
  maxDepth: 4,
  maxRelativePathBytes: 128,
};

function target(overrides: Record<string, unknown> = {}) {
  return createBackupTarget({
    id: "local-backup",
    displayName: "Local backup",
    kind: "mock",
    schedule: { mode: "manual" },
    retention: { keepLastSuccessful: 1 },
    limits,
    ...overrides,
  });
}

describe("backup target domain", () => {
  it("creates an immutable mock target with bounded public fields", () => {
    const value = target();
    expect(value.sourcePath).toBeNull();
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("rejects missing fields, unsafe sources, and unsupported kinds", () => {
    expect(() => createBackupTarget({ id: "x" } as never)).toThrow();
    expect(() => target({ kind: "shell" })).toThrow();
    expect(() =>
      target({ kind: "filesystem_tree", sourcePath: "/" }),
    ).toThrow();
    expect(() =>
      target({ kind: "filesystem_tree", sourcePath: "/proc/example" }),
    ).toThrow();
    expect(() => target({ id: "../backup" })).toThrow();
  });

  it("supports disabled and scheduled modes through one vocabulary", () => {
    expect(target({ schedule: { mode: "disabled" } }).schedule.mode).toBe(
      "disabled",
    );
    expect(
      target({
        schedule: {
          mode: "scheduled",
          timezone: "America/Sao_Paulo",
          windows: [{ weekday: "monday", start: "03:00", end: "03:30" }],
        },
      }).schedule.mode,
    ).toBe("scheduled");
  });
});
