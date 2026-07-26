import { describe, expect, it } from "vitest";

import {
  formatEnvironmentValidationError,
  LOG_LEVELS,
  parseEnvironment,
} from "../../src/config/environment.js";

describe("parseEnvironment", () => {
  it("uses the default host and port when values are absent", () => {
    const config = parseEnvironment({});

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
    });
    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBeUndefined();
  });

  it("accepts a custom host and converts a custom port to a number", () => {
    expect(
      parseEnvironment({
        HOST: "0.0.0.0",
        PORT: "8080",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 8080,
      logLevel: "info",
    });
  });

  it.each(LOG_LEVELS)("accepts the %s log level", (logLevel) => {
    expect(parseEnvironment({ LOG_LEVEL: logLevel }).logLevel).toBe(logLevel);
  });

  it("rejects an unsupported log level", () => {
    expect(() => parseEnvironment({ LOG_LEVEL: "verbose" })).toThrow();
  });

  it.each([
    ["a non-numeric port", "invalid"],
    ["a zero port", "0"],
    ["a negative port", "-1"],
    ["a port above the TCP range", "65536"],
    ["a decimal port", "3000.5"],
  ])("rejects %s", (_description, port) => {
    expect(() => parseEnvironment({ PORT: port })).toThrow();
  });

  it("formats validation errors without stack traces or internal paths", () => {
    let validationError: unknown;

    try {
      parseEnvironment({ PORT: "0" });
    } catch (error) {
      validationError = error;
    }

    expect(formatEnvironmentValidationError(validationError)).toBe(
      "Invalid environment configuration:\n" +
        "- PORT: must be between 1 and 65535",
    );
  });

  it("does not format unexpected errors as configuration errors", () => {
    expect(formatEnvironmentValidationError(new Error("unexpected"))).toBe(
      undefined,
    );
  });

  it("formats an invalid log level without exposing its value", () => {
    let validationError: unknown;

    try {
      parseEnvironment({ LOG_LEVEL: "verbose" });
    } catch (error) {
      validationError = error;
    }

    expect(formatEnvironmentValidationError(validationError)).toBe(
      "Invalid environment configuration:\n" +
        "- LOG_LEVEL: must be one of: trace, debug, info, warn, error, fatal, silent",
    );
  });

  it("preserves an exact absolute scheduler cursor file path", () => {
    const filePath =
      "/var/lib/atlas-manager/reconciliation-scheduler-cursor.json";

    const config = parseEnvironment({
      SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: filePath,
    });

    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBe(filePath);
  });

  it.each([
    ["empty", "", "must not be empty"],
    ["whitespace only", "   ", "must not contain surrounding whitespace"],
    [
      "leading whitespace",
      " /var/lib/atlas-manager/cursor.json",
      "must not contain surrounding whitespace",
    ],
    [
      "trailing whitespace",
      "/var/lib/atlas-manager/cursor.json ",
      "must not contain surrounding whitespace",
    ],
    ["filename", "cursor.json", "must be an absolute path"],
    ["dot-relative path", "./state/cursor.json", "must be an absolute path"],
    ["relative path", "state/cursor.json", "must be an absolute path"],
  ])(
    "rejects a %s scheduler cursor path without exposing its value",
    (_description, filePath, expectedReason) => {
      let validationError: unknown;

      try {
        parseEnvironment({
          SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: filePath,
        });
      } catch (error) {
        validationError = error;
      }

      const message = formatEnvironmentValidationError(validationError);

      expect(message).toBe(
        "Invalid environment configuration:\n" +
          "- SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: " +
          expectedReason,
      );
      if (filePath.length > 0) {
        expect(message).not.toContain(filePath);
      }
      expect(message).not.toContain(process.cwd());
      expect(message).not.toContain("stack");
      expect(message).not.toContain("serviceAvailability");
    },
  );
});
