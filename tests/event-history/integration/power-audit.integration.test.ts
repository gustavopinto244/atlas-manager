import { describe, expect, it } from "vitest";

import { createEventHistory } from "../../../src/event-history/composition/create-event-history.js";
import { InMemoryAdministrativeEventHistory } from "../../../src/event-history/infrastructure/in-memory-administrative-event-history.js";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";
import {
  MockMachineShutdownConfirmationReader,
  MockMachineShutdownServiceReadinessReader,
} from "../../../src/power-management/infrastructure/mock-machine-shutdown-readiness-readers.js";
import { createMachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";
import type {
  AdministrativeEventInput,
  AdministrativeEvent,
} from "../../../src/event-history/domain/administrative-event.js";
import type { AdministrativeEventRecorder } from "../../../src/event-history/application/ports/administrative-event-recorder.js";
import type {
  AdministrativeEventHistoryReadinessReader,
  AdministrativeEventHistoryReadinessResult,
  AdministrativeEventHistoryReader,
} from "../../../src/event-history/application/ports/administrative-event-history-reader.js";
import type { AdministrativeEventHistoryPage } from "../../../src/event-history/domain/administrative-event-history-page.js";

const NOW = "2026-08-01T12:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";
const OCCURRENCE = createMachineShutdownOccurrence({
  operation: "shutdown",
  scheduledFor: "2026-08-01T11:00:00.000Z",
  wakeScheduledFor: "2026-08-03T09:00:00.000Z",
});

function clock(): PowerManagementClock {
  return { now: () => new Date(NOW) };
}

class FailOnSecondRecord
  implements
    AdministrativeEventRecorder,
    AdministrativeEventHistoryReader,
    AdministrativeEventHistoryReadinessReader
{
  readonly #store = new InMemoryAdministrativeEventHistory();
  #calls = 0;

  public record(input: AdministrativeEventInput): Promise<AdministrativeEvent> {
    this.#calls += 1;
    if (this.#calls === 2) return Promise.reject(new Error("hidden"));
    return this.#store.record(input);
  }

  public query(input?: unknown): Promise<AdministrativeEventHistoryPage> {
    return this.#store.query(input);
  }

  public check(): Promise<AdministrativeEventHistoryReadinessResult> {
    return this.#store.check();
  }
}

describe("power-management administrative event integration", () => {
  it("audits direct wake mutations with one attempt per top-level operation", async () => {
    const history = createEventHistory();
    const capabilities = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });

    await capabilities.scheduleWakeAlarm.execute({ scheduledFor: LATER });
    await capabilities.scheduleWakeAlarm.execute({
      scheduledFor: "2026-08-03T09:00:00.000Z",
    });
    await capabilities.cancelWakeAlarm.execute();

    const page = await history.getAdministrativeEventHistory.execute();
    expect(
      page.events.map((event) => [
        event.sequence,
        event.operation,
        event.status,
      ]),
    ).toEqual([
      [1, "schedule_wake_alarm", "started"],
      [2, "schedule_wake_alarm", "succeeded"],
      [3, "schedule_wake_alarm", "started"],
      [4, "schedule_wake_alarm", "succeeded"],
      [5, "cancel_wake_alarm", "started"],
      [6, "cancel_wake_alarm", "succeeded"],
    ]);
    expect(new Set(page.events.map((event) => event.attemptId)).size).toBe(3);
    expect(new Set(page.events.map((event) => event.occurredAt))).toEqual(
      new Set([NOW]),
    );
  });

  it("audits an occurrence once without nested wake or shutdown events", async () => {
    const history = createEventHistory();
    const capabilities = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
      machineShutdownConfirmationReader:
        new MockMachineShutdownConfirmationReader("confirmed"),
      machineShutdownServiceReadinessReader:
        new MockMachineShutdownServiceReadinessReader({
          state: "ready",
          blockers: [],
        }),
    });

    await expect(
      capabilities.executeMachineShutdownOccurrence.execute(OCCURRENCE),
    ).resolves.toMatchObject({ outcome: "executed" });
    const page = await history.getAdministrativeEventHistory.execute();
    expect(page.events.map((event) => [event.operation, event.status])).toEqual(
      [
        ["execute_machine_shutdown_occurrence", "started"],
        ["execute_machine_shutdown_occurrence", "succeeded"],
      ],
    );
    expect(page.events[1]?.details).toMatchObject({
      executionOutcome: "executed",
      wakeMutationOutcome: "scheduled",
      shutdownAccepted: true,
    });
  });

  it("fails closed when the shared event history is unavailable", async () => {
    const store = new InMemoryAdministrativeEventHistory({
      readiness: "unavailable",
    });
    const history = createEventHistory({
      recorder: store,
      reader: store,
      readiness: store,
    });
    const capabilities = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
      machineShutdownConfirmationReader:
        new MockMachineShutdownConfirmationReader("confirmed"),
      machineShutdownServiceReadinessReader:
        new MockMachineShutdownServiceReadinessReader({
          state: "ready",
          blockers: [],
        }),
    });

    const result =
      await capabilities.executeMachineShutdownOccurrence.execute(OCCURRENCE);
    expect(result.outcome).toBe("rejected");
    if (result.outcome !== "rejected")
      throw new Error("expected rejected occurrence");
    expect(result.decision.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "event_recording_unavailable" }),
      ]),
    );
  });

  it("prevents effects when the started event cannot be recorded", async () => {
    const store = new InMemoryAdministrativeEventHistory({
      recordFailure: new Error("hidden"),
    });
    const history = createEventHistory({
      recorder: store,
      reader: store,
      readiness: store,
    });
    const capabilities = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });

    await expect(
      capabilities.scheduleWakeAlarm.execute({ scheduledFor: LATER }),
    ).rejects.toMatchObject({ code: "administrative_audit_failed" });
    await expect(
      capabilities.getNextWakeAlarm.execute(),
    ).resolves.toMatchObject({
      wakeAlarm: { state: "not_scheduled" },
    });
  });

  it("preserves a wake mutation when terminal audit recording fails", async () => {
    const store = new FailOnSecondRecord();
    const history = createEventHistory({
      recorder: store,
      reader: store,
      readiness: store,
    });
    const capabilities = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });

    await expect(
      capabilities.scheduleWakeAlarm.execute({ scheduledFor: LATER }),
    ).rejects.toMatchObject({
      code: "audit_failed_after_wake_alarm_mutation",
    });
    await expect(
      capabilities.getNextWakeAlarm.execute(),
    ).resolves.toMatchObject({
      wakeAlarm: { state: "scheduled", scheduledFor: LATER },
    });
  });

  it("records scheduler attempts with the trusted automated source", async () => {
    const history = createEventHistory();
    const capabilities = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });

    await capabilities.runMachinePowerSchedulerTick.execute();
    const page = await history.getAdministrativeEventHistory.execute();
    expect(
      page.events.map((event) => [event.operation, event.status, event.source]),
    ).toEqual([
      [
        "run_machine_power_scheduler_tick",
        "started",
        { kind: "automated", actorId: "machine-power-scheduler" },
      ],
      [
        "run_machine_power_scheduler_tick",
        "succeeded",
        { kind: "automated", actorId: "machine-power-scheduler" },
      ],
    ]);
  });
});
