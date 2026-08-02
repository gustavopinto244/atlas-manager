import { describe, expect, it } from "vitest";

import { ScheduledPolicyMachineShutdownConfirmationReader } from "../../../src/power-management/infrastructure/scheduled-policy-machine-shutdown-confirmation-reader.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";
import type { ScheduledMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";
import { createMachineShutdownOccurrencesForInterval } from "../../../src/power-management/domain/machine-shutdown-occurrence-interval.js";
import type { MachineShutdownOccurrence } from "../../../src/power-management/domain/machine-shutdown-occurrence.js";

const EVALUATED_AT = "2026-08-03T21:00:00.000Z";

const scheduledPolicy = createMachineOperatingPolicy({
  mode: "scheduled",
  timezone: "America/Sao_Paulo",
  weeklySchedule: {
    windows: [
      { dayOfWeek: "monday", start: "08:00", end: "18:00" },
      { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
    ],
  },
}) as ScheduledMachineOperatingPolicy;

const exactOccurrence = {
  operation: "shutdown" as const,
  scheduledFor: "2026-08-03T21:00:00.000Z",
  wakeScheduledFor: "2026-08-04T12:00:00.000Z",
};

describe("ScheduledPolicyMachineShutdownConfirmationReader", () => {
  it.each([{ mode: "always_on" }, { mode: "manual" }])(
    "does not confirm $mode policies",
    (policy) => {
      const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
        createMachineOperatingPolicy(policy),
      );

      return expect(reader.read(exactOccurrence, EVALUATED_AT)).resolves.toBe(
        "not_confirmed",
      );
    },
  );

  it("confirms one exact generated scheduled occurrence", async () => {
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      scheduledPolicy,
    );

    await expect(reader.read(exactOccurrence, EVALUATED_AT)).resolves.toBe(
      "confirmed",
    );
  });

  it.each([
    "2026-08-03T20:59:59.999Z",
    "2026-08-03T20:59:59.000Z",
    "2026-08-03T20:59:00.000Z",
    "2026-08-03T21:01:00.000Z",
  ])("rejects a non-boundary scheduledFor at %s", (scheduledFor) => {
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      scheduledPolicy,
    );
    const occurrence = {
      ...exactOccurrence,
      scheduledFor,
    };

    return expect(reader.read(occurrence, EVALUATED_AT)).resolves.toBe(
      "not_confirmed",
    );
  });

  it("rejects an incorrect wake timestamp and invented occurrences", async () => {
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      scheduledPolicy,
    );

    await expect(
      reader.read(
        { ...exactOccurrence, wakeScheduledFor: "2026-08-04T12:01:00.000Z" },
        EVALUATED_AT,
      ),
    ).resolves.toBe("not_confirmed");
    await expect(
      reader.read(
        {
          operation: "shutdown",
          scheduledFor: "2026-08-03T19:00:00.000Z",
          wakeScheduledFor: "2026-08-04T12:00:00.000Z",
        },
        EVALUATED_AT,
      ),
    ).resolves.toBe("not_confirmed");
  });

  it("confirms a Sunday-to-Monday weekly wraparound", async () => {
    const policy = createMachineOperatingPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [
          { dayOfWeek: "sunday", start: "22:00", end: "23:00" },
          { dayOfWeek: "monday", start: "08:00", end: "10:00" },
        ],
      },
    });
    const occurrences = createMachineShutdownOccurrencesForInterval(
      policy,
      "2026-08-02T01:00:00.000Z",
      "2026-08-03T12:00:00.000Z",
    );
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(policy);

    expect(occurrences).toHaveLength(1);
    await expect(
      reader.read(occurrences[0]!, occurrences[0]!.scheduledFor),
    ).resolves.toBe("confirmed");
  });

  it("does not depend on input window ordering", async () => {
    const reordered = createMachineOperatingPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [
          { dayOfWeek: "tuesday", start: "09:00", end: "17:00" },
          { dayOfWeek: "monday", start: "08:00", end: "18:00" },
        ],
      },
    });
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      reordered,
    );

    await expect(reader.read(exactOccurrence, EVALUATED_AT)).resolves.toBe(
      "confirmed",
    );
  });

  it("fails closed when policy evaluation unexpectedly fails", async () => {
    const invalidPolicy = {
      mode: "scheduled",
      timezone: "Not/A_Timezone",
      weeklySchedule: scheduledPolicy.weeklySchedule,
    } as never;
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      invalidPolicy,
    );

    await expect(
      reader.read(exactOccurrence, EVALUATED_AT),
    ).rejects.toMatchObject({
      name: "ScheduledPolicyMachineShutdownConfirmationError",
      code: "policy_evaluation_failed",
    });
  });

  it("does not mutate the canonical policy or expose it in errors", async () => {
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      scheduledPolicy,
    );
    const before = JSON.stringify(scheduledPolicy);

    await reader.read(exactOccurrence, EVALUATED_AT);

    expect(JSON.stringify(scheduledPolicy)).toBe(before);
    expect(Object.isFrozen(scheduledPolicy)).toBe(true);
    expect(Object.isFrozen(reader)).toBe(true);
  });

  it("rejects malformed occurrences without normalizing them", async () => {
    const reader = new ScheduledPolicyMachineShutdownConfirmationReader(
      scheduledPolicy,
    );
    const malformed = {
      ...exactOccurrence,
      operation: "poweroff",
    } as unknown as MachineShutdownOccurrence;

    await expect(reader.read(malformed, EVALUATED_AT)).resolves.toBe(
      "not_confirmed",
    );
  });
});
