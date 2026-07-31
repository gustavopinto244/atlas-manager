import {
  chmodSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileAdministrativeEventHistory } from "../../../src/event-history/infrastructure/file-administrative-event-history.js";

const SOURCE = {
  kind: "administrative" as const,
  actorId: "unattributed-local" as const,
};
const TARGET = { kind: "machine" as const, id: "atlas" as const };

function input(index: number, status: "started" | "succeeded" = "started") {
  return {
    attemptId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    occurredAt: "2026-08-01T12:00:00.000Z",
    source: SOURCE,
    target: TARGET,
    operation: "cancel_wake_alarm" as const,
    status,
    ...(status === "succeeded"
      ? { details: { mutationOutcome: "cancelled" as const } }
      : {}),
  };
}

function fixture(): { directory: string; file: string } {
  const directory = mkdtempSync(join(tmpdir(), "atlas-event-history-"));
  return { directory, file: join(directory, "events.jsonl") };
}

function cleanup(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

describe("FileAdministrativeEventHistory", () => {
  it("queries a missing file without creating it and creates a secure file on record", async () => {
    const { directory, file } = fixture();
    try {
      const store = new FileAdministrativeEventHistory(file);
      await expect(store.query()).resolves.toEqual({
        events: [],
        hasMore: false,
      });
      expect(() => statSync(file)).toThrow();
      await store.record(input(1));
      const mode = statSync(file).mode & 0o777;
      expect(mode).toBe(0o600);
      expect(readFileSync(file, "utf8").endsWith("\n")).toBe(true);
    } finally {
      cleanup(directory);
    }
  });

  it("reconstructs process-style state and continues the sequence", async () => {
    const { directory, file } = fixture();
    try {
      const first = new FileAdministrativeEventHistory(file);
      await first.record(input(1));
      await first.record(input(1, "succeeded"));
      const second = new FileAdministrativeEventHistory(file);
      await second.record(input(2));
      const page = await second.query({ afterSequence: 2 });
      expect(page.events).toHaveLength(1);
      expect(page.events[0]?.sequence).toBe(3);
    } finally {
      cleanup(directory);
    }
  });

  it("fails closed on malformed or noncanonical history content", async () => {
    const { directory, file } = fixture();
    try {
      const store = new FileAdministrativeEventHistory(file);
      writeFileSync(file, '{"version":1}\n', { mode: 0o600 });
      await expect(store.query()).rejects.toMatchObject({
        code: "event_history_corrupted",
      });
      await expect(store.check()).resolves.toEqual({
        outcome: "unavailable",
        code: "event_history_corrupted",
      });
    } finally {
      cleanup(directory);
    }
  });

  it("rejects unsafe event files and parents without repairing them", async () => {
    const { directory, file } = fixture();
    try {
      const store = new FileAdministrativeEventHistory(file);
      await store.record(input(1));
      chmodSync(file, 0o640);
      await expect(store.query()).rejects.toMatchObject({
        code: "event_history_permissions_unsafe",
      });
      expect(statSync(file).mode & 0o777).toBe(0o640);
      mkdirSync(join(directory, "unsafe"));
      chmodSync(join(directory, "unsafe"), 0o777);
      expect(
        () =>
          new FileAdministrativeEventHistory(
            join(directory, "unsafe", "events.jsonl"),
          ),
      ).not.toThrow();
    } finally {
      cleanup(directory);
    }
  });
});
