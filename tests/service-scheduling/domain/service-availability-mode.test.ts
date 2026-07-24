import { describe, expect, it, vi } from "vitest";

import * as availabilityModeModule from "../../../src/service-scheduling/domain/service-availability-mode.js";
import {
  createServiceAvailabilityMode,
  SERVICE_AVAILABILITY_MODES,
  ServiceAvailabilityModeValidationError,
} from "../../../src/service-scheduling/domain/service-availability-mode.js";

const validationErrorMessage =
  "Invalid service availability mode: invalid_availability_mode";

describe("ServiceAvailabilityMode", () => {
  it("defines the approved modes in canonical declaration order", () => {
    expect(SERVICE_AVAILABILITY_MODES).toEqual([
      "always",
      "scheduled",
      "manual",
      "disabled",
    ]);
    expect(Object.isFrozen(SERVICE_AVAILABILITY_MODES)).toBe(true);
  });

  it.each(SERVICE_AVAILABILITY_MODES)(
    "accepts and returns %s unchanged",
    (mode) => {
      expect(createServiceAvailabilityMode(mode)).toBe(mode);
    },
  );

  it.each([
    "",
    " ",
    " always",
    "always ",
    "Always",
    "ALWAYS",
    "sCheDuled",
    "enabled",
    "automatic",
    "schedule",
    "off",
    "inactive",
    "on-demand",
    "sched",
    "manual\u0000",
    "readStatus",
    "start",
    "stop",
    "restart",
  ])("rejects the non-canonical string %j", (value) => {
    expect(() => createServiceAvailabilityMode(value)).toThrow(
      ServiceAvailabilityModeValidationError,
    );
  });

  it.each([undefined, null, true, false, 0, 1, [], {}, ["always"]])(
    "safely rejects the runtime-invalid value %j without coercion",
    (value) => {
      const runtimeValue: unknown = value;

      expect(() =>
        createServiceAvailabilityMode(runtimeValue as string),
      ).toThrow(ServiceAvailabilityModeValidationError);
    },
  );

  it("reports a stable safe validation error", () => {
    const rejectedValue = "credential-secret-mode";

    try {
      createServiceAvailabilityMode(rejectedValue);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceAvailabilityModeValidationError);
      expect(error).toMatchObject({
        name: "ServiceAvailabilityModeValidationError",
        code: "invalid_availability_mode",
        message: validationErrorMessage,
      });
      expect(String(error)).not.toContain(rejectedValue);
      expect(Object.values(error as object)).not.toContain(rejectedValue);
      expect(error).not.toHaveProperty("cause");
      expect(String(error)).not.toContain("always");
      expect(String(error)).not.toContain("scheduled");
      expect(String(error)).not.toContain("manual");
      expect(String(error)).not.toContain("disabled");
    }
  });

  it("cannot be changed through attempted public allowlist mutation", () => {
    const mutableView = SERVICE_AVAILABILITY_MODES as unknown as string[];

    expect(() => mutableView.push("enabled")).toThrow(TypeError);
    expect(() => mutableView.splice(0, 1)).toThrow(TypeError);
    expect(() => {
      mutableView[0] = "enabled";
    }).toThrow(TypeError);

    expect(SERVICE_AVAILABILITY_MODES).toEqual([
      "always",
      "scheduled",
      "manual",
      "disabled",
    ]);
    expect(createServiceAvailabilityMode("always")).toBe("always");
    expect(() => createServiceAvailabilityMode("enabled")).toThrow(
      ServiceAvailabilityModeValidationError,
    );
  });

  it("exposes no dynamic mode-registration operation", () => {
    expect(Object.keys(availabilityModeModule).sort()).toEqual(
      [
        "SERVICE_AVAILABILITY_MODES",
        "ServiceAvailabilityModeValidationError",
        "createServiceAvailabilityMode",
      ].sort(),
    );
  });

  it("imports without timers or process listeners", async () => {
    vi.resetModules();
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOnSpy = vi.spyOn(process, "on");

    try {
      await import("../../../src/service-scheduling/domain/service-availability-mode.js");

      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(processOnSpy).not.toHaveBeenCalled();
    } finally {
      setTimeoutSpy.mockRestore();
      processOnSpy.mockRestore();
    }
  });
});
