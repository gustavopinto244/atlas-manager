import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  FileEventHistoryWriterLock,
  FileEventHistoryWriterLockError,
} from "../../../src/event-history/infrastructure/file-event-history-writer-lock.js";

function fixture(): string {
  return mkdtempSync(join(tmpdir(), "atlas-event-history-lock-"));
}

describe("FileEventHistoryWriterLock", () => {
  it("serializes writers and verifies owner tokens", () => {
    const root = fixture();
    try {
      const path = join(root, "writer.lock");
      const options = {
        processIsLive: (pid: number) => pid === process.pid,
        processStartIdentity: (pid: number) =>
          pid === process.pid ? "start-101" : undefined,
        currentProcessStartIdentity: () => "start-101",
        currentUserId: () => process.getuid?.() ?? 0,
        clock: () => "2026-08-02T12:00:00.000Z",
      };
      const first = new FileEventHistoryWriterLock(path, options);
      const handle = first.acquire("append");
      expect(first.inspect().state).toBe("busy");
      const second = new FileEventHistoryWriterLock(path, options);
      expect(() => second.acquire("append")).toThrowError(
        new FileEventHistoryWriterLockError("busy"),
      );
      expect(() => first.release("wrong-token")).toThrowError(
        new FileEventHistoryWriterLockError("not_owner"),
      );
      first.release(handle.token);
      expect(first.inspect().state).toBe("absent");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("classifies stale locks without removing them", () => {
    const root = fixture();
    try {
      const path = join(root, "writer.lock");
      mkdirSync(path, { mode: 0o700 });
      writeFileSync(
        join(path, "metadata.json"),
        JSON.stringify({
          schemaVersion: 1,
          ownerPid: 404,
          ownerProcessStart: "gone",
          operation: "append",
          acquiredAt: "2026-08-02T12:00:00.000Z",
          ownerToken: "00000000-0000-4000-8000-000000000001",
        }) + "\n",
        { mode: 0o600 },
      );
      const lock = new FileEventHistoryWriterLock(path, {
        processIsLive: () => false,
        processStartIdentity: () => undefined,
        currentProcessStartIdentity: () => "self",
      });
      expect(lock.inspect()).toMatchObject({ state: "stale", ownerPid: 404 });
      expect(() => lock.acquire("append")).toThrowError(
        new FileEventHistoryWriterLockError("stale"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
