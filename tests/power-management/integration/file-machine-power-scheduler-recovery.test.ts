import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import { createSequenceClock } from "../../test-helpers/controlled-time.js";

const policy = {
  mode: "scheduled" as const,
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [
      { dayOfWeek: "monday", start: "08:00", end: "18:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
    ],
  },
};
describe("file-backed machine power scheduler recovery", () => {
  it("reconstructs cursor and claim state across fresh compositions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-power-recovery-"));
    try {
      const persistence = {
        occurrenceClaimFilePath: join(directory, "claims.json"),
        schedulerCursorFilePath: join(directory, "cursor.json"),
      };
      const first = createPowerManagement({
        persistence,
        machineOperatingPolicy: policy,
        clock: createSequenceClock([new Date("2026-08-03T13:00:00.000Z")]),
      });
      await expect(
        first.runMachinePowerSchedulerTick.execute(),
      ).resolves.toMatchObject({ kind: "initialized" });
      const second = createPowerManagement({
        persistence,
        machineOperatingPolicy: policy,
        clock: createSequenceClock([new Date("2026-08-03T20:59:00.000Z")]),
      });
      await expect(
        second.runMachinePowerSchedulerTick.execute(),
      ).resolves.toMatchObject({
        kind: "advanced",
        report: { occurrenceResults: [] },
      });
      const third = createPowerManagement({
        persistence,
        machineOperatingPolicy: policy,
        clock: createSequenceClock([
          new Date("2026-08-03T21:00:00.000Z"),
          new Date("2026-08-03T21:00:00.000Z"),
        ]),
      });
      await expect(
        third.runMachinePowerSchedulerTick.execute(),
      ).resolves.toMatchObject({
        kind: "advanced",
        report: {
          occurrenceResults: [
            { kind: "completed", execution: { outcome: "executed" } },
          ],
        },
      });
      expect(
        await readFile(persistence.schedulerCursorFilePath, "utf8"),
      ).toContain("2026-08-03T21:00:00.000Z");
      const fourth = createPowerManagement({
        persistence,
        machineOperatingPolicy: policy,
        clock: createSequenceClock([new Date("2026-08-03T21:05:00.000Z")]),
      });
      await expect(
        fourth.runMachinePowerSchedulerTick.execute(),
      ).resolves.toMatchObject({ kind: "advanced" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects malformed persistence before any power effect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-power-invalid-"));
    try {
      const claimPath = join(directory, "claims.json");
      const cursorPath = join(directory, "cursor.json");
      await writeFile(cursorPath, "{bad", "utf8");
      const shutdown = { requestShutdown: vi.fn() };
      const capabilities = createPowerManagement({
        persistence: {
          occurrenceClaimFilePath: claimPath,
          schedulerCursorFilePath: cursorPath,
        },
        machineShutdownController: shutdown,
      });
      await expect(
        capabilities.runMachinePowerSchedulerTick.execute(),
      ).rejects.toMatchObject({ code: "invalid_cursor_file" });
      expect(shutdown.requestShutdown).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
