import { describe, expect, it, vi } from "vitest";
import { EvaluateMachineShutdownReadiness } from "../../../src/power-management/application/evaluate-machine-shutdown-readiness.js";
import {
  MockMachineShutdownConfirmationReader,
  MockMachineShutdownReadinessReader,
  MockMachineShutdownServiceReadinessReader,
} from "../../../src/power-management/infrastructure/mock-machine-shutdown-readiness-readers.js";

const occurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};
const ready = (
  area: "active_tasks" | "backups" | "filesystem" | "event_recording",
) => new MockMachineShutdownReadinessReader({ area, state: "ready" });
describe("evaluate machine shutdown readiness", () => {
  it("rejects by default confirmation before reading remaining dependencies", async () => {
    const services = { read: vi.fn() };
    const evaluator = new EvaluateMachineShutdownReadiness(
      { now: vi.fn(() => new Date("2026-08-03T21:00:00.000Z")) },
      {
        confirmation: new MockMachineShutdownConfirmationReader(),
        services,
        activeTasks: ready("active_tasks"),
        backups: ready("backups"),
        filesystem: ready("filesystem"),
        eventRecording: ready("event_recording"),
      },
    );
    await expect(evaluator.execute(occurrence)).resolves.toMatchObject({
      outcome: "rejected",
      blockers: [{ code: "not_confirmed" }],
    });
    expect(services.read).not.toHaveBeenCalled();
  });
  it("approves only after confirmation and all readiness areas are ready", async () => {
    const calls: string[] = [];
    const reader = (
      area: "active_tasks" | "backups" | "filesystem" | "event_recording",
    ) => ({
      read: vi.fn(async () => {
        calls.push(area);
        return { area, state: "ready" as const };
      }),
    });
    const evaluator = new EvaluateMachineShutdownReadiness(
      { now: vi.fn(() => new Date("2026-08-03T21:00:00.000Z")) },
      {
        confirmation: {
          read: vi.fn(async () => {
            calls.push("confirmation");
            return "confirmed" as const;
          }),
        },
        services: {
          read: vi.fn(async () => {
            calls.push("services");
            return { state: "ready" as const, blockers: [] as const };
          }),
        },
        activeTasks: reader("active_tasks"),
        backups: reader("backups"),
        filesystem: reader("filesystem"),
        eventRecording: reader("event_recording"),
      },
    );
    await expect(evaluator.execute(occurrence)).resolves.toMatchObject({
      outcome: "approved",
      blockers: [],
    });
    expect(calls).toEqual([
      "confirmation",
      "services",
      "active_tasks",
      "backups",
      "filesystem",
      "event_recording",
    ]);
  });
  it("collects blockers and hides dependency failures", async () => {
    const evaluator = new EvaluateMachineShutdownReadiness(
      { now: vi.fn(() => new Date("2026-08-03T21:00:00.000Z")) },
      {
        confirmation: new MockMachineShutdownConfirmationReader("confirmed"),
        services: new MockMachineShutdownServiceReadinessReader({
          state: "blocked",
          blockers: [
            {
              area: "services",
              code: "service_running",
              serviceId: "atlas-api",
            },
          ],
        }),
        activeTasks: new MockMachineShutdownReadinessReader({
          area: "active_tasks",
          state: "blocked",
          activeTaskCount: 2,
        }),
        backups: new MockMachineShutdownReadinessReader(
          { area: "backups", state: "ready" },
          new Error("private"),
        ),
        filesystem: ready("filesystem"),
        eventRecording: ready("event_recording"),
      },
    );
    const result = await evaluator.execute(occurrence);
    expect(result).toMatchObject({
      outcome: "rejected",
      blockers: [
        { code: "service_running" },
        { code: "active_tasks_present" },
        { code: "readiness_dependency_failed" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });
  it("does not read confirmation when not due or stale", async () => {
    const confirmation = { read: vi.fn() };
    const evaluator = new EvaluateMachineShutdownReadiness(
      { now: vi.fn(() => new Date("2026-08-03T20:00:00.000Z")) },
      {
        confirmation,
        services: new MockMachineShutdownServiceReadinessReader(),
        activeTasks: ready("active_tasks"),
        backups: ready("backups"),
        filesystem: ready("filesystem"),
        eventRecording: ready("event_recording"),
      },
    );
    await expect(evaluator.execute(occurrence)).resolves.toMatchObject({
      blockers: [{ code: "not_due" }],
    });
    expect(confirmation.read).not.toHaveBeenCalled();
  });
});
