import { describe, expect, it, vi } from "vitest";

import { ServiceAvailabilityModeValidationError } from "../../../src/service-scheduling/domain/service-availability-mode.js";
import {
  createServiceAvailabilityPolicy,
  type ServiceAvailabilityPolicy,
} from "../../../src/service-scheduling/domain/service-availability-policy.js";
import { ServiceAvailabilityPolicyValidationError } from "../../../src/service-scheduling/domain/service-availability-policy-validation-error.js";
import { ServiceScheduleTimezoneValidationError } from "../../../src/service-scheduling/domain/service-schedule-timezone.js";
import { ServiceScheduleValidationError } from "../../../src/service-scheduling/domain/service-schedule-validation-error.js";

const canonicalTimezone = "America/Sao_Paulo";
const validWindow = {
  weekday: "monday",
  start: "09:00",
  end: "12:00",
};

function expectPolicyError(input: unknown): void {
  expect(() => createServiceAvailabilityPolicy(input)).toThrowError(
    expect.objectContaining({
      name: "ServiceAvailabilityPolicyValidationError",
      code: "invalid_service_availability_policy",
      message: "Invalid service availability policy",
    }),
  );
}

function captureError(input: unknown): unknown {
  try {
    createServiceAvailabilityPolicy(input);
    throw new Error("Expected policy creation to fail");
  } catch (error) {
    return error;
  }
}

describe("ServiceAvailabilityPolicy", () => {
  it.each(["always", "manual", "disabled"] as const)(
    "creates a frozen canonical %s policy",
    (mode) => {
      const source = { mode };
      const policy = createServiceAvailabilityPolicy(source);

      expect(policy).toEqual({ mode, timezone: null, schedule: null });
      expect(policy).not.toBe(source);
      expect(Object.isFrozen(policy)).toBe(true);

      source.mode = mode === "always" ? "manual" : "always";

      expect(policy.mode).toBe(mode);
    },
  );

  it("creates a deeply frozen scheduled policy using canonical window order", () => {
    const fridayWindow = {
      weekday: "friday",
      start: "13:00",
      end: "17:00",
    };
    const mondayWindow = { ...validWindow };
    const windows = [fridayWindow, mondayWindow];
    const source = {
      mode: "scheduled",
      timezone: canonicalTimezone,
      windows,
    };
    const policy = createServiceAvailabilityPolicy(source);

    expect(policy).toEqual({
      mode: "scheduled",
      timezone: canonicalTimezone,
      schedule: {
        windows: [
          validWindow,
          { weekday: "friday", start: "13:00", end: "17:00" },
        ],
      },
    });
    expect(Object.keys(policy)).toEqual(["mode", "timezone", "schedule"]);
    expect(Object.isFrozen(policy)).toBe(true);
    expect(policy.schedule).not.toBeNull();

    if (policy.schedule === null) {
      throw new Error("Expected a scheduled policy");
    }

    expect(Object.isFrozen(policy.schedule)).toBe(true);
    expect(Object.isFrozen(policy.schedule.windows)).toBe(true);
    expect(policy.schedule.windows.every(Object.isFrozen)).toBe(true);
    expect(policy.schedule.windows).not.toBe(windows);
    expect(policy.schedule.windows[0]).not.toBe(mondayWindow);

    source.timezone = "UTC";
    windows.reverse();
    mondayWindow.weekday = "sunday";
    fridayWindow.start = "14:00";

    expect(policy).toEqual({
      mode: "scheduled",
      timezone: canonicalTimezone,
      schedule: {
        windows: [
          validWindow,
          { weekday: "friday", start: "13:00", end: "17:00" },
        ],
      },
    });
  });

  it.each([
    undefined,
    null,
    true,
    false,
    0,
    "scheduled",
    [],
    new Date(0),
    (): object => ({}),
    {},
    { timezone: canonicalTimezone, windows: [validWindow] },
  ])("rejects the invalid top-level structure %#", (input) => {
    expectPolicyError(input);
  });

  it("rejects inherited mode and own symbol fields", () => {
    expectPolicyError(Object.create({ mode: "always" }));
    expectPolicyError({ mode: "always", [Symbol("metadata")]: true });
    expectPolicyError({
      mode: "scheduled",
      timezone: canonicalTimezone,
      windows: [validWindow],
      [Symbol("metadata")]: true,
    });
  });

  it.each([
    { mode: "always", timezone: canonicalTimezone },
    { mode: "always", windows: [validWindow] },
    { mode: "manual", timezone: undefined, windows: undefined },
    { mode: "disabled", timezone: null, windows: null },
    { mode: "disabled", schedule: null },
    { mode: "always", metadata: "sentinel-policy-metadata" },
  ])("rejects extra configuration for a non-scheduled mode %#", (input) => {
    expectPolicyError(input);
  });

  it.each([
    { mode: "scheduled" },
    { mode: "scheduled", timezone: canonicalTimezone },
    { mode: "scheduled", windows: [validWindow] },
    { mode: "scheduled", timezone: undefined, windows: [validWindow] },
    { mode: "scheduled", timezone: canonicalTimezone, windows: undefined },
    { mode: "scheduled", timezone: canonicalTimezone, schedule: null },
    {
      mode: "scheduled",
      timezone: canonicalTimezone,
      windows: [validWindow],
      metadata: "sentinel-policy-metadata",
    },
  ])("rejects a non-exact scheduled policy shape %#", (input) => {
    expectPolicyError(input);
  });

  it("propagates the existing mode error unchanged", () => {
    const error = captureError({ mode: "sentinel-invalid-mode" });

    expect(error).toBeInstanceOf(ServiceAvailabilityModeValidationError);
    expect(error).toMatchObject({ code: "invalid_availability_mode" });
    expect(error).not.toBeInstanceOf(ServiceAvailabilityPolicyValidationError);
  });

  it("propagates the existing timezone error unchanged", () => {
    const error = captureError({
      mode: "scheduled",
      timezone: "sentinel-invalid-timezone",
      windows: [validWindow],
    });

    expect(error).toBeInstanceOf(ServiceScheduleTimezoneValidationError);
    expect(error).toMatchObject({ code: "invalid_schedule_timezone" });
    expect(error).not.toBeInstanceOf(ServiceAvailabilityPolicyValidationError);
  });

  it.each([
    [
      [{ ...validWindow, weekday: "sentinel-weekday" }],
      "invalid_schedule_weekday",
    ],
    [
      [{ ...validWindow, start: "sentinel-time" }],
      "invalid_schedule_local_time",
    ],
    [
      [{ ...validWindow, start: "12:00", end: "09:00" }],
      "invalid_weekly_availability_window",
    ],
    [[], "empty_weekly_availability_schedule"],
    [
      Array.from({ length: 65 }, () => ({ ...validWindow })),
      "weekly_availability_schedule_limit_exceeded",
    ],
    [
      [validWindow, { weekday: "monday", start: "11:00", end: "13:00" }],
      "overlapping_weekly_availability_windows",
    ],
  ])("preserves the schedule validation code %s", (windows, code) => {
    const error = captureError({
      mode: "scheduled",
      timezone: canonicalTimezone,
      windows,
    });

    expect(error).toBeInstanceOf(ServiceScheduleValidationError);
    expect(error).toMatchObject({ code });
    expect(error).not.toBeInstanceOf(ServiceAvailabilityPolicyValidationError);
  });

  it("returns equal canonical values for equal configuration", () => {
    const input = {
      mode: "scheduled",
      timezone: canonicalTimezone,
      windows: [validWindow],
    };

    expect(createServiceAvailabilityPolicy(input)).toEqual(
      createServiceAvailabilityPolicy(input),
    );
  });

  it("keeps policy validation errors generic and free of source data", () => {
    const sentinels = [
      "sentinel-policy-metadata",
      "sentinel-service-id",
      "sentinel-source-error",
    ];
    const error = captureError({
      mode: "always",
      metadata: sentinels.join(":"),
    });

    expect(error).toBeInstanceOf(ServiceAvailabilityPolicyValidationError);
    expect(error).toMatchObject({
      code: "invalid_service_availability_policy",
      message: "Invalid service availability policy",
    });
    expect(error).not.toHaveProperty("cause");
    expect(error).not.toHaveProperty("input");
    expect(error).not.toHaveProperty("mode");
    expect(error).not.toHaveProperty("timezone");
    expect(error).not.toHaveProperty("windows");

    for (const sentinel of sentinels) {
      expect(String(error)).not.toContain(sentinel);
      expect(Object.values(error as object)).not.toContain(sentinel);
    }
  });

  it("imports and creates policies without time or process side effects", async () => {
    vi.resetModules();
    const dateSpy = vi.spyOn(globalThis, "Date");
    const dateNowSpy = vi.spyOn(Date, "now");
    const dateTimeFormatSpy = vi.spyOn(Intl, "DateTimeFormat");
    const supportedValuesOfSpy = vi.spyOn(Intl, "supportedValuesOf");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      const policyModule =
        await import("../../../src/service-scheduling/domain/service-availability-policy.js");
      const policy: ServiceAvailabilityPolicy =
        policyModule.createServiceAvailabilityPolicy({ mode: "manual" });

      expect(policy.mode).toBe("manual");
      expect(dateSpy).not.toHaveBeenCalled();
      expect(dateNowSpy).not.toHaveBeenCalled();
      expect(dateTimeFormatSpy).not.toHaveBeenCalled();
      expect(supportedValuesOfSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      dateNowSpy.mockRestore();
      dateTimeFormatSpy.mockRestore();
      supportedValuesOfSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
