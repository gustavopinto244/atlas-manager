import { describe, expect, it } from "vitest";

import {
  createAdministrativeEvent,
  createAdministrativeEventInput,
  createAdministrativeEventSource,
  createAdministrativeEventTarget,
} from "../../../src/event-history/domain/administrative-event.js";
import {
  ADMINISTRATIVE_OPERATIONS,
  permissionForAdministrativeOperation,
} from "../../../src/access-control/domain/administrative-operation.js";

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
    expect(
      createAdministrativeEventSource({
        kind: "administrative",
        actorId: "administrator:00000000-0000-4000-8000-000000000001",
      }),
    ).toEqual({
      kind: "administrative",
      actorId: "administrator:00000000-0000-4000-8000-000000000001",
    });
    expect(
      createAdministrativeEventSource({
        kind: "administrative",
        actorId: "administrator:caf45cc3-4312-5d41-8603-cc0102346a1f",
      }),
    ).toEqual({
      kind: "administrative",
      actorId: "administrator:caf45cc3-4312-5d41-8603-cc0102346a1f",
    });
    expect(
      createAdministrativeEventSource({
        kind: "administrative",
        actorId: "unauthenticated",
      }),
    ).toEqual({ kind: "administrative", actorId: "unauthenticated" });
    expect(() =>
      createAdministrativeEventSource({
        kind: "administrative",
        actorId: "administrator:00000000-0000-4000-8000-000000000002",
      }),
    ).not.toThrow();
    expect(() =>
      createAdministrativeEventSource({
        kind: "administrative",
        actorId: "administrator:00000000-0000-4000-8000-00000000000Z",
      }),
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
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "authorize_administrative_operation",
        status: "succeeded",
        details: {
          requestedOperation: "read_wake_alarm",
          permission: "power.wake.read",
          decision: "allowed",
        },
      }),
    ).toBeTruthy();
    expect(() =>
      createAdministrativeEventInput({
        ...common,
        operation: "authorize_administrative_operation",
        status: "succeeded",
        details: {
          requestedOperation: "read_wake_alarm",
          permission: "power.wake.schedule",
          decision: "allowed",
        },
      }),
    ).toThrow();
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "authorize_administrative_operation",
        status: "succeeded",
        details: {
          requestedOperation: "schedule_wake_alarm",
          permission: "power.wake.schedule",
          decision: "allowed",
        },
      }),
    ).toBeTruthy();
    expect(
      createAdministrativeEventInput({
        ...common,
        operation: "authorize_administrative_operation",
        status: "rejected",
        details: {
          requestedOperation: "schedule_wake_alarm",
          permission: "power.wake.schedule",
          decision: "denied",
          reasonCode: "permission_denied",
        },
      }),
    ).toBeTruthy();
    expect(() =>
      createAdministrativeEventInput({
        ...common,
        operation: "authorize_administrative_operation",
        status: "succeeded",
        details: {
          requestedOperation: "schedule_wake_alarm",
          permission: "power.wake.cancel",
          decision: "allowed",
        },
      }),
    ).toThrow();
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

describe("authorization audit details coverage", () => {
  const common = {
    attemptId: ATTEMPT_ID,
    occurredAt: OCCURRED_AT,
    source: SOURCE,
    target: TARGET,
  };

  /**
   * Regression guard. This validator used to keep its own hand-written copy of
   * the operation vocabulary, and it drifted: eighteen operations the
   * access-control domain defines could not be authorization-audited at all,
   * which surfaced to callers as HTTP 503 `authorization_audit_unavailable` on
   * service logs, service schedule reads and mutations, every backup read, and
   * the event-history operations. Every operation that can be authorized must
   * be recordable, or the route it belongs to cannot work.
   */
  it.each([...ADMINISTRATIVE_OPERATIONS])(
    "records an allowed authorization decision for %s",
    (operation) => {
      expect(
        createAdministrativeEventInput({
          ...common,
          operation: "authorize_administrative_operation",
          status: "succeeded",
          details: {
            requestedOperation: operation,
            permission: permissionForAdministrativeOperation(operation),
            decision: "allowed",
          },
        }),
      ).toBeTruthy();
    },
  );

  it.each([...ADMINISTRATIVE_OPERATIONS])(
    "records a denied authorization decision for %s",
    (operation) => {
      expect(
        createAdministrativeEventInput({
          ...common,
          operation: "authorize_administrative_operation",
          status: "rejected",
          details: {
            requestedOperation: operation,
            permission: permissionForAdministrativeOperation(operation),
            decision: "denied",
            reasonCode: "permission_denied",
          },
        }),
      ).toBeTruthy();
    },
  );

  it("still refuses an operation the access-control domain does not define", () => {
    expect(() =>
      createAdministrativeEventInput({
        ...common,
        operation: "authorize_administrative_operation",
        status: "succeeded",
        details: {
          requestedOperation: "rotate_administrative_event_history",
          permission: "event_history.rotation.run",
          decision: "allowed",
        },
      }),
    ).toThrow();
  });
});
