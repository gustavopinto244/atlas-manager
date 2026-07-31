import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileMachinePowerSchedulerCursorStore } from "../../../src/power-management/infrastructure/file-machine-power-scheduler-cursor-store.js";
import { FileMachineShutdownOccurrenceClaimStore } from "../../../src/power-management/infrastructure/file-machine-shutdown-occurrence-claim-store.js";

describe("file-backed machine power persistence", () => {
  it("persists and reconstructs cursors and claims", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-power-"));
    try {
      const cursorPath = join(directory, "cursor.json");
      const claimPath = join(directory, "claims.json");
      const cursorStore = new FileMachinePowerSchedulerCursorStore(cursorPath);
      const claimStore = new FileMachineShutdownOccurrenceClaimStore(claimPath);
      const cursor = { completedThrough: "2026-08-03T21:00:00.000Z" };
      const occurrence = {
        operation: "shutdown" as const,
        scheduledFor: "2026-08-03T21:00:00.000Z",
        wakeScheduledFor: "2026-08-04T12:00:00.000Z",
      };
      await expect(cursorStore.read()).resolves.toBeNull();
      await expect(cursorStore.advance(null, cursor)).resolves.toMatchObject({
        kind: "advanced",
      });
      await expect(claimStore.claim(occurrence)).resolves.toEqual({
        outcome: "claimed",
      });
      await expect(
        new FileMachinePowerSchedulerCursorStore(cursorPath).read(),
      ).resolves.toEqual(cursor);
      await expect(
        new FileMachineShutdownOccurrenceClaimStore(claimPath).claim(
          occurrence,
        ),
      ).resolves.toEqual({ outcome: "duplicate" });
      expect(await readFile(cursorPath, "utf8")).toBe(
        `${JSON.stringify({ version: 1, completedThrough: cursor.completedThrough })}\n`,
      );
      expect((await readFile(claimPath, "utf8")).endsWith("\n")).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
