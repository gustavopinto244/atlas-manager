import { describe, expect, it, vi } from "vitest";

import { createAdministrativeAccessControl } from "../../src/access-control/composition/create-administrative-access-control.js";
import { createProtectedAdministration } from "../../src/access-control/composition/create-protected-administration.js";
import { createAdministrativePrincipal } from "../../src/access-control/domain/administrative-principal.js";
import { MockAdministrativeAuthenticationProvider } from "../../src/access-control/infrastructure/mock-administrative-authentication-provider.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../../src/access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createEventHistory } from "../../src/event-history/composition/create-event-history.js";
import { InMemoryAdministrativeEventHistory } from "../../src/event-history/infrastructure/in-memory-administrative-event-history.js";
import { createPowerManagement } from "../../src/power-management/composition/create-power-management.js";
import type { PowerManagementClock } from "../../src/power-management/application/ports/power-management-clock.js";

const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000001";
const NOW = "2026-08-01T12:00:00.000Z";
const LATER = "2026-08-02T09:00:00.000Z";

function clock(): PowerManagementClock {
  return { now: vi.fn(() => new Date(NOW)) };
}

function access(
  roles: readonly string[],
  result: "authenticated" | "unauthenticated" = "authenticated",
) {
  const authenticator = new MockAdministrativeAuthenticationProvider({
    result:
      result === "authenticated"
        ? { outcome: result, principal: { principalId: PRINCIPAL_ID } }
        : { outcome: result, reason: "credentials_absent" },
  });
  const rolesReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: roles.length > 0 ? [{ principalId: PRINCIPAL_ID, roles }] : [],
  });
  return {
    capabilities: createAdministrativeAccessControl({
      authenticator,
      roleAssignmentReader: rolesReader,
    }),
    authenticator,
    rolesReader,
  };
}

describe("administrative access-control foundation", () => {
  it("uses immutable canonical principals and a fixed fail-closed policy", async () => {
    const principal = createAdministrativePrincipal({
      principalId: PRINCIPAL_ID,
    });
    const configured = access(["power_operator"]);
    const allowed =
      await configured.capabilities.authorizeAdministrativeOperation.execute({
        principal,
        operation: "schedule_wake_alarm",
        evaluatedAt: NOW,
      });
    const denied =
      await configured.capabilities.authorizeAdministrativeOperation.execute({
        principal,
        operation: "read_administrative_event_history",
        evaluatedAt: NOW,
      });
    expect(allowed).toMatchObject({
      outcome: "allowed",
      permission: "power.wake.schedule",
    });
    expect(denied).toMatchObject({
      outcome: "denied",
      reason: "permission_denied",
    });
    expect(Object.isFrozen(principal)).toBe(true);
    expect(configured.rolesReader.lookupPrincipalIds).toEqual([
      PRINCIPAL_ID,
      PRINCIPAL_ID,
    ]);
  });

  it("authenticates once, audits authorization, and propagates a verified actor", async () => {
    const history = createEventHistory();
    const configured = access(["power_operator"]);
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    await protectedAdministration.scheduleWakeAlarm.execute({
      scheduledFor: LATER,
    });
    const page = await history.getAdministrativeEventHistory.execute();
    expect(configured.authenticator.invocationCount).toBe(1);
    expect(configured.rolesReader.lookupPrincipalIds).toEqual([PRINCIPAL_ID]);
    expect(page.events.map((event) => [event.operation, event.status])).toEqual(
      [
        ["authorize_administrative_operation", "succeeded"],
        ["schedule_wake_alarm", "started"],
        ["schedule_wake_alarm", "succeeded"],
      ],
    );
    expect(page.events[0]?.details).toEqual({
      requestedOperation: "schedule_wake_alarm",
      permission: "power.wake.schedule",
      decision: "allowed",
    });
    expect(
      page.events
        .slice(1)
        .every(
          (event) => event.source.actorId === `administrator:${PRINCIPAL_ID}`,
        ),
    ).toBe(true);
  });

  it("denies unauthenticated requests before role lookup and target effects", async () => {
    const history = createEventHistory();
    const configured = access([], "unauthenticated");
    const schedule = vi.fn();
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
      wakeAlarmController: { schedule, cancel: vi.fn() },
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    await expect(
      protectedAdministration.scheduleWakeAlarm.execute({
        scheduledFor: LATER,
      }),
    ).rejects.toMatchObject({ code: "administrative_authentication_required" });
    expect(configured.rolesReader.lookupPrincipalIds).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    const page = await history.getAdministrativeEventHistory.execute();
    expect(page.events).toHaveLength(1);
    expect(page.events[0]).toMatchObject({
      source: { kind: "administrative", actorId: "unauthenticated" },
      operation: "authorize_administrative_operation",
      status: "rejected",
      details: {
        requestedOperation: "schedule_wake_alarm",
        permission: "power.wake.schedule",
        decision: "denied",
        reasonCode: "credentials_absent",
      },
    });
  });

  it("keeps shutdown confirmation independent from authorization", async () => {
    const history = createEventHistory();
    const configured = access(["power_operator"]);
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
      machineShutdownConfirmationReader: {
        read: vi.fn().mockResolvedValue("not_confirmed"),
      },
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });
    const occurrence = {
      operation: "shutdown",
      scheduledFor: "2026-08-01T11:00:00.000Z",
      wakeScheduledFor: "2026-08-03T09:00:00.000Z",
    };

    await expect(
      protectedAdministration.executeMachineShutdownOccurrence.execute(
        occurrence,
      ),
    ).resolves.toMatchObject({ outcome: "rejected" });
    const page = await history.getAdministrativeEventHistory.execute();
    expect(page.events.map((event) => [event.operation, event.status])).toEqual(
      [
        ["authorize_administrative_operation", "succeeded"],
        ["execute_machine_shutdown_occurrence", "started"],
        ["execute_machine_shutdown_occurrence", "rejected"],
      ],
    );
    expect(page.events[2]?.details).toMatchObject({
      executionOutcome: "rejected",
      blockerCodes: ["not_confirmed"],
    });
  });

  it("fails closed for unknown principals and unavailable role data", async () => {
    const history = createEventHistory();
    const authenticator = new MockAdministrativeAuthenticationProvider({
      result: {
        outcome: "authenticated",
        principal: { principalId: PRINCIPAL_ID },
      },
    });
    const roles = new InMemoryAdministrativeRoleAssignmentReader({
      failure: new Error("hidden role-store error"),
    });
    const accessControl = createAdministrativeAccessControl({
      authenticator,
      roleAssignmentReader: roles,
    });
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    await expect(
      protectedAdministration.cancelWakeAlarm.execute(),
    ).rejects.toMatchObject({
      code: "administrative_authorization_unavailable",
    });
    expect(roles.lookupPrincipalIds).toEqual([PRINCIPAL_ID]);
    const page = await history.getAdministrativeEventHistory.execute();
    expect(page.events[0]?.details).toMatchObject({
      decision: "denied",
      reasonCode: "role_assignment_unavailable",
    });
  });

  it("does not invoke a target when authorization audit recording is unavailable", async () => {
    const store = new InMemoryAdministrativeEventHistory({
      recordFailure: new Error("hidden event-store failure"),
    });
    const history = createEventHistory({
      recorder: store,
      reader: store,
      readiness: store,
    });
    const configured = access(["power_operator"]);
    const controller = { schedule: vi.fn(), cancel: vi.fn() };
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
      wakeAlarmController: controller,
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    await expect(
      protectedAdministration.scheduleWakeAlarm.execute({
        scheduledFor: LATER,
      }),
    ).rejects.toMatchObject({ code: "authorization_audit_unavailable" });
    expect(controller.schedule).not.toHaveBeenCalled();
  });

  it("protects event-history reads and denies a non-auditor", async () => {
    const history = createEventHistory();
    const configured = access(["auditor"]);
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    const page =
      await protectedAdministration.getAdministrativeEventHistory.execute({
        limit: 10,
      });
    expect(page).toMatchObject({
      events: [
        expect.objectContaining({
          operation: "authorize_administrative_operation",
          status: "succeeded",
        }),
      ],
      hasMore: false,
    });
    expect(Object.isFrozen(page)).toBe(true);

    const nonAuditor = access(["power_operator"]);
    const denied = createProtectedAdministration({
      accessControl: nonAuditor.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });
    await expect(
      denied.getAdministrativeEventHistory.execute(),
    ).rejects.toMatchObject({ code: "administrative_authorization_denied" });
  });

  it("protects wake-alarm reads with one shared authorization timestamp", async () => {
    const history = createEventHistory();
    const configured = access(["power_operator"]);
    const reader = vi.fn(async (observedAt: string) => ({
      observedAt,
      wakeAlarm: { state: "not_scheduled" as const },
    }));
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
      wakeAlarmReader: { read: reader },
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    await expect(
      protectedAdministration.getNextWakeAlarm.execute(),
    ).resolves.toMatchObject({
      observedAt: NOW,
      wakeAlarm: { state: "not_scheduled" },
    });
    expect(reader).toHaveBeenCalledWith(NOW);
    const events = await history.getAdministrativeEventHistory.execute();
    expect(events.events.map((event) => event.operation)).toEqual([
      "authorize_administrative_operation",
    ]);
    expect(events.events[0]?.details).toMatchObject({
      requestedOperation: "read_wake_alarm",
      permission: "power.wake.read",
      decision: "allowed",
    });
  });

  it("audits a manual scheduler tick as the administrator", async () => {
    const history = createEventHistory();
    const configured = access(["scheduler_operator"]);
    const power = createPowerManagement({
      clock: clock(),
      administrativeEventHistoryCapabilities: history,
    });
    const protectedAdministration = createProtectedAdministration({
      accessControl: configured.capabilities,
      powerManagement: power,
      eventHistory: history,
      clock: clock(),
    });

    await protectedAdministration.runMachinePowerSchedulerTick.execute();
    const page = await history.getAdministrativeEventHistory.execute();
    expect(page.events.map((event) => [event.operation, event.status])).toEqual(
      [
        ["authorize_administrative_operation", "succeeded"],
        ["run_machine_power_scheduler_tick", "started"],
        ["run_machine_power_scheduler_tick", "succeeded"],
      ],
    );
    expect(page.events[1]?.source).toEqual({
      kind: "administrative",
      actorId: `administrator:${PRINCIPAL_ID}`,
    });
  });
});
