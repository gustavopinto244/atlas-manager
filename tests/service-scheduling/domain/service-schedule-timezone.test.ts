import { describe, expect, it, vi } from "vitest";

import * as timezoneModule from "../../../src/service-scheduling/domain/service-schedule-timezone.js";
import {
  createServiceScheduleTimezone,
  SERVICE_SCHEDULE_TIMEZONES,
  ServiceScheduleTimezoneValidationError,
} from "../../../src/service-scheduling/domain/service-schedule-timezone.js";

const canonicalTimezone = "America/Sao_Paulo";
const validationErrorMessage = "Invalid service schedule timezone";

describe("ServiceScheduleTimezone", () => {
  it("defines exactly the initial approved timezone", () => {
    expect(SERVICE_SCHEDULE_TIMEZONES).toEqual([canonicalTimezone]);
    expect(SERVICE_SCHEDULE_TIMEZONES).toHaveLength(1);
    expect(Object.isFrozen(SERVICE_SCHEDULE_TIMEZONES)).toBe(true);
  });

  it("accepts and returns the canonical timezone unchanged", () => {
    expect(createServiceScheduleTimezone(canonicalTimezone)).toBe(
      canonicalTimezone,
    );
  });

  it.each([
    "",
    " ",
    " America/Sao_Paulo",
    "America/Sao_Paulo ",
    "america/sao_paulo",
    "AMERICA/SAO_PAULO",
    "America/sao_Paulo",
    "America/São_Paulo",
    "America/Sao Paulo",
    "America/Sao-Paulo",
    "America\\Sao_Paulo",
    "America//Sao_Paulo",
    "America/",
    "/Sao_Paulo",
    "America",
    "Sao_Paulo",
    "America/Sao",
    "America/Sao_Paulo\u0000",
  ])("rejects the non-canonical identifier %j", (value) => {
    expect(() => createServiceScheduleTimezone(value)).toThrow(
      ServiceScheduleTimezoneValidationError,
    );
  });

  it.each([
    "UTC",
    "Etc/UTC",
    "GMT",
    "Europe/London",
    "Europe/Lisbon",
    "America/New_York",
    "America/Recife",
    "America/Fortaleza",
    "America/Manaus",
    "America/Rio_Branco",
    "Brazil/East",
    "system",
    "local",
  ])("rejects the unapproved timezone %s", (value) => {
    expect(() => createServiceScheduleTimezone(value)).toThrow(
      ServiceScheduleTimezoneValidationError,
    );
  });

  it.each([
    undefined,
    null,
    true,
    false,
    0,
    1,
    [],
    {},
    ["America/Sao_Paulo"],
    (): string => canonicalTimezone,
    Symbol("America/Sao_Paulo"),
  ])("rejects the runtime-invalid value %j without coercion", (value) => {
    const runtimeValue: unknown = value;

    expect(() => createServiceScheduleTimezone(runtimeValue as string)).toThrow(
      ServiceScheduleTimezoneValidationError,
    );
  });

  it.each(["credential-secret-timezone", "UTC"])(
    "returns the same stable safe error for %s",
    (rejectedValue) => {
      try {
        createServiceScheduleTimezone(rejectedValue);
        throw new Error("Expected validation to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(ServiceScheduleTimezoneValidationError);
        expect(error).toMatchObject({
          name: "ServiceScheduleTimezoneValidationError",
          code: "invalid_schedule_timezone",
          message: validationErrorMessage,
        });
        expect(String(error)).not.toContain(rejectedValue);
        expect(Object.values(error as object)).not.toContain(rejectedValue);
        expect(error).not.toHaveProperty("cause");
        expect(String(error)).not.toContain(canonicalTimezone);
        expect(String(error)).not.toContain(typeof rejectedValue);
      }
    },
  );

  it("cannot be changed through attempted allowlist mutation", () => {
    const mutableView = SERVICE_SCHEDULE_TIMEZONES as unknown as string[];

    expect(() => mutableView.push("UTC")).toThrow(TypeError);
    expect(() => mutableView.splice(0, 1)).toThrow(TypeError);
    expect(() => {
      mutableView[0] = "UTC";
    }).toThrow(TypeError);

    expect(SERVICE_SCHEDULE_TIMEZONES).toEqual([canonicalTimezone]);
    expect(createServiceScheduleTimezone(canonicalTimezone)).toBe(
      canonicalTimezone,
    );
    expect(() => createServiceScheduleTimezone("UTC")).toThrow(
      ServiceScheduleTimezoneValidationError,
    );
  });

  it("exposes no timezone or alias registration API", () => {
    expect(Object.keys(timezoneModule).sort()).toEqual(
      [
        "SERVICE_SCHEDULE_TIMEZONES",
        "ServiceScheduleTimezoneValidationError",
        "createServiceScheduleTimezone",
      ].sort(),
    );
  });

  it("imports without Date, Intl, timers, or process listeners", async () => {
    vi.resetModules();
    const dateSpy = vi.spyOn(globalThis, "Date");
    const dateTimeFormatSpy = vi.spyOn(Intl, "DateTimeFormat");
    const supportedValuesOfSpy = vi.spyOn(Intl, "supportedValuesOf");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      await import("../../../src/service-scheduling/domain/service-schedule-timezone.js");

      expect(dateSpy).not.toHaveBeenCalled();
      expect(dateTimeFormatSpy).not.toHaveBeenCalled();
      expect(supportedValuesOfSpy).not.toHaveBeenCalled();
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      dateSpy.mockRestore();
      dateTimeFormatSpy.mockRestore();
      supportedValuesOfSpy.mockRestore();
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
