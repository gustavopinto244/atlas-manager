import { describe, expect, it } from "vitest";

import {
  createAdministrativeEvent,
  createAdministrativeEventInput,
  createAdministrativeEventSource,
  createAdministrativeEventTarget,
} from "../../../src/event-history/domain/administrative-event.js";

const ATTEMPT_ID = "00000000-0000-4000-8000-000000000001";
const OCCURRED_AT = "2026-08-01T12:00:00.000Z";
const TARGET = { kind: "machine" as const, id: "atlas" as const };
const SOURCE = {
  kind: "administrative" as const,
  actorId: "unattributed-local" as const,
};

function startedSchedule() {
  return {
    attemptId: ATTEMPT_ID,
    occurredAt: OCCURRED_AT,
    source: SOURCE,
    target: TARGET,
    operation: "schedule_wake_alarm" as const,
    status: "started" as const,
    details: { scheduledFor: "2026-08-02T09:00:00.000Z" },
  };
}

describe("administrative event domain", () => {
  it("creates deeply immutable source, target, details, and stored event", () => {
    const input = startedSchedule();
    const event = createAdministrativeEvent({ sequence: 1, ...input });

    expect(event).toEqual({ sequence: 1, ...input });
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.source)).toBe(true);
    expect(Object.isFrozen(event.target)).toBe(true);
    expect(Object.isFrozen(event.details)).toBe(true);

    expect(() => {
      (event as { status: string }).status = "failed";
    }).toThrow();
  });

  it("accepts only the trusted source and Atlas machine target combinations", () => {
    expect(
      createAdministrativeEventSource({
        kind: "automated",
        actorId: "machine-power-scheduler",
      }),
    ).toEqual({ kind: "automated", actorId: "machine-power-scheduler" });
    expect(
      createAdministrativeEventSource({
        kind: "system",
        actorId: "atlas-manager",
      }),
    ).toEqual({ kind: "system", actorId: "atlas-manager" });
    expect(createAdministrativeEventTarget(TARGET)).toEqual(TARGET);

    expect(() =>
      createAdministrativeEventSource({
        kind: "administrative",
        actorId: "atlas-manager",
      }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventTarget({ kind: "host", id: "atlas" }),
    ).toThrow();
  });

  it("validates operation-specific details and rejects unsafe metadata", () => {
    expect(() =>
      createAdministrativeEventInput({
        ...startedSchedule(),
        details: {
          scheduledFor: "2026-08-02T09:00:00.000Z",
          rawError: "secret",
        },
      }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventInput({
        ...startedSchedule(),
        details: { scheduledFor: "not-a-timestamp" },
      }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventInput({
        ...startedSchedule(),
        status: "failed",
        details: { failureCode: "raw_errno" },
      }),
    ).toThrow();
    expect(() =>
      createAdministrativeEventInput({
        ...startedSchedule(),
        [Symbol("unknown")]: true,
      }),
    ).toThrow();
  });

  it("accepts all operation lifecycle shapes used by power auditing", () => {
    const common = {
      attemptId: ATTEMPT_ID,
      occurredAt: OCCURRED_AT,
      source: SOURCE,
      target: TARGET,
    };
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "cancel_wake_alarm",
        status: "started",
      }),
    ).toBeTruthy();
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "request_machine_shutdown",
        status: "succeeded",
        details: { accepted: true },
      }),
    ).toBeTruthy();
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "execute_machine_shutdown_occurrence",
        status: "rejected",
        details: { executionOutcome: "duplicate" },
      }),
    ).toBeTruthy();
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "run_machine_power_scheduler_tick",
        status: "succeeded",
        details: { schedulerOutcome: "initialized", complete: true },
      }),
    ).toBeTruthy();
  });

  it("isolates caller-owned nested values", () => {
    const source = { ...SOURCE };
    const details = { scheduledFor: "2026-08-02T09:00:00.000Z" };
    const event = createAdministrativeEventInput({
      ...startedSchedule(),
      source,
      details,
    });
    source.actorId = "unattributed-local";
    details.scheduledFor = "2026-08-03T09:00:00.000Z";
    expect(event.source.actorId).toBe("unattributed-local");
    expect(event.details?.scheduledFor).toBe("2026-08-02T09:00:00.000Z");
  });
});
