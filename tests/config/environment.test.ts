import { describe, expect, it } from "vitest";

import {
  formatEnvironmentValidationError,
  LOG_LEVELS,
  parseEnvironment,
} from "../../src/config/environment.js";

describe("parseEnvironment", () => {
  it("keeps administrative event-history HTTP disabled by default", () => {
    expect(parseEnvironment({}).administrativeEventHistoryHttpEnabled).toBe(
      false,
    );
  });

  it.each(["1", "0", "yes", "no", "TRUE", "False", "", " true"])(
    "rejects non-canonical administrative HTTP boolean %s",
    (enabled) => {
      expect(() =>
        parseEnvironment({
          ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: enabled,
        }),
      ).toThrow();
    },
  );

  it("accepts complete loopback administrative HTTP configuration", () => {
    const config = parseEnvironment({
      HOST: "127.0.0.1",
      CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
      CLOUDFLARE_ACCESS_AUDIENCE: "atlas-admin",
      ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: "true",
      ADMINISTRATIVE_EVENT_HISTORY_FILE:
        "/var/lib/atlas-manager/admin-events.jsonl",
      ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
        {
          principalId: "00000000-0000-4000-8000-000000000001",
          roles: ["auditor"],
        },
      ]),
    });

    expect(config.administrativeEventHistoryHttpEnabled).toBe(true);
    expect(config.administrativeEventHistoryFilePath).toBe(
      "/var/lib/atlas-manager/admin-events.jsonl",
    );
    expect(config.administrativeRoleAssignments).toEqual([
      {
        principal: {
          principalId: "00000000-0000-4000-8000-000000000001",
        },
        roles: ["auditor"],
      },
    ]);
  });

  it.each([
    ["missing Cloudflare configuration", { HOST: "127.0.0.1" }],
    [
      "missing event-history file",
      {
        HOST: "127.0.0.1",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "aud",
      },
    ],
    [
      "missing role assignments",
      {
        HOST: "127.0.0.1",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "aud",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/events.jsonl",
      },
    ],
    [
      "non-loopback host",
      {
        HOST: "0.0.0.0",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "aud",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/events.jsonl",
        ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
          {
            principalId: "00000000-0000-4000-8000-000000000001",
            roles: ["auditor"],
          },
        ]),
      },
    ],
    [
      "no read-capable role",
      {
        HOST: "127.0.0.1",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "aud",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/events.jsonl",
        ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
          {
            principalId: "00000000-0000-4000-8000-000000000001",
            roles: ["power_operator"],
          },
        ]),
      },
    ],
  ])("rejects enabled configuration with %s", (_description, values) => {
    expect(() =>
      parseEnvironment({
        ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: "true",
        ...values,
      }),
    ).toThrow();
  });

  it("rejects duplicate role principals and persistence paths", () => {
    const assignment = {
      principalId: "00000000-0000-4000-8000-000000000001",
      roles: ["auditor"],
    };
    expect(() =>
      parseEnvironment({
        ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: "true",
        HOST: "127.0.0.1",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "aud",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/events.jsonl",
        SERVICE_AVAILABILITY_OVERRIDE_FILE:
          "/var/lib/atlas-manager/events.jsonl",
        ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
          assignment,
          assignment,
        ]),
      }),
    ).toThrow();
  });

  it("uses the default host and port when values are absent", () => {
    const config = parseEnvironment({});

    expect(config).toEqual({
      host: "127.0.0.1",
      port: 3000,
      logLevel: "info",
      administrativeEventHistoryHttpEnabled: false,
    });
    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBeUndefined();
    expect(
      config.serviceAvailabilityReconciliationOccurrenceClaimFilePath,
    ).toBeUndefined();
    expect(config.serviceAvailabilityOverrideFilePath).toBeUndefined();
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
      administrativeEventHistoryHttpEnabled: false,
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

  it("preserves an exact absolute occurrence claim file path", () => {
    const filePath =
      "/var/lib/atlas-manager/reconciliation-occurrence-claims.json";

    const config = parseEnvironment({
      SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: filePath,
    });

    expect(
      config.serviceAvailabilityReconciliationOccurrenceClaimFilePath,
    ).toBe(filePath);
    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBeUndefined();
  });

  it.each([
    ["empty", "", "must not be empty"],
    ["whitespace only", "   ", "must not contain surrounding whitespace"],
    [
      "leading whitespace",
      " /var/lib/atlas-manager/claims.json",
      "must not contain surrounding whitespace",
    ],
    [
      "trailing whitespace",
      "/var/lib/atlas-manager/claims.json ",
      "must not contain surrounding whitespace",
    ],
    ["filename", "claims.json", "must be an absolute path"],
    ["dot-relative path", "./state/claims.json", "must be an absolute path"],
    ["relative path", "state/claims.json", "must be an absolute path"],
  ])(
    "rejects a %s occurrence claim path without exposing its value",
    (_description, filePath, expectedReason) => {
      let validationError: unknown;

      try {
        parseEnvironment({
          SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: filePath,
        });
      } catch (error) {
        validationError = error;
      }

      const message = formatEnvironmentValidationError(validationError);

      expect(message).toBe(
        "Invalid environment configuration:\n" +
          "- SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: " +
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

  it("accepts distinct cursor and occurrence claim paths unchanged", () => {
    const cursorPath = "/var/lib/atlas-manager/cursor.json";
    const claimPath = "/var/lib/atlas-manager/claims.json";

    const config = parseEnvironment({
      SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: cursorPath,
      SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: claimPath,
    });

    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBe(cursorPath);
    expect(
      config.serviceAvailabilityReconciliationOccurrenceClaimFilePath,
    ).toBe(claimPath);
  });

  it("rejects an exact cursor and occurrence claim path collision safely", () => {
    const sharedPath = "/var/lib/atlas-manager/reconciliation-state.json";
    let validationError: unknown;

    try {
      parseEnvironment({
        SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: sharedPath,
        SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: sharedPath,
      });
    } catch (error) {
      validationError = error;
    }

    const message = formatEnvironmentValidationError(validationError);

    expect(message).toBe(
      "Invalid environment configuration:\n" +
        "- SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: " +
        "must differ from the scheduler cursor file path",
    );
    expect(message).not.toContain(sharedPath);
  });

  it("preserves an exact absolute availability override file path", () => {
    const filePath =
      "/var/lib/atlas-manager/service-availability-overrides.json";

    const config = parseEnvironment({
      SERVICE_AVAILABILITY_OVERRIDE_FILE: filePath,
    });

    expect(config.serviceAvailabilityOverrideFilePath).toBe(filePath);
    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBeUndefined();
    expect(
      config.serviceAvailabilityReconciliationOccurrenceClaimFilePath,
    ).toBeUndefined();
  });

  it.each([
    ["empty", "", "must not be empty"],
    ["whitespace only", "   ", "must not contain surrounding whitespace"],
    [
      "leading whitespace",
      " /var/lib/atlas-manager/overrides.json",
      "must not contain surrounding whitespace",
    ],
    [
      "trailing whitespace",
      "/var/lib/atlas-manager/overrides.json ",
      "must not contain surrounding whitespace",
    ],
    ["filename", "overrides.json", "must be an absolute path"],
    ["dot-relative path", "./state/overrides.json", "must be an absolute path"],
    ["relative path", "state/overrides.json", "must be an absolute path"],
  ])(
    "rejects a %s availability override path without exposing its value",
    (_description, filePath, expectedReason) => {
      let validationError: unknown;

      try {
        parseEnvironment({
          SERVICE_AVAILABILITY_OVERRIDE_FILE: filePath,
        });
      } catch (error) {
        validationError = error;
      }

      const message = formatEnvironmentValidationError(validationError);

      expect(message).toBe(
        "Invalid environment configuration:\n" +
          "- SERVICE_AVAILABILITY_OVERRIDE_FILE: " +
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

  it("accepts three distinct persistence paths unchanged", () => {
    const cursorPath = "/var/lib/atlas-manager/cursor.json";
    const claimPath = "/var/lib/atlas-manager/claims.json";
    const overridePath = "/var/lib/atlas-manager/overrides.json";

    const config = parseEnvironment({
      SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: cursorPath,
      SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: claimPath,
      SERVICE_AVAILABILITY_OVERRIDE_FILE: overridePath,
    });

    expect(
      config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
    ).toBe(cursorPath);
    expect(
      config.serviceAvailabilityReconciliationOccurrenceClaimFilePath,
    ).toBe(claimPath);
    expect(config.serviceAvailabilityOverrideFilePath).toBe(overridePath);
  });

  it.each([
    [
      "scheduler cursor",
      {
        SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE:
          "/var/lib/atlas-manager/shared.json",
        SERVICE_AVAILABILITY_OVERRIDE_FILE:
          "/var/lib/atlas-manager/shared.json",
      },
      "must differ from the scheduler cursor file path",
    ],
    [
      "occurrence claim",
      {
        SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE:
          "/var/lib/atlas-manager/shared.json",
        SERVICE_AVAILABILITY_OVERRIDE_FILE:
          "/var/lib/atlas-manager/shared.json",
      },
      "must differ from the occurrence claim file path",
    ],
  ])(
    "rejects an exact override and %s path collision safely",
    (_description, environment, expectedReason) => {
      let validationError: unknown;

      try {
        parseEnvironment(environment);
      } catch (error) {
        validationError = error;
      }

      const message = formatEnvironmentValidationError(validationError);

      expect(message).toBe(
        "Invalid environment configuration:\n" +
          `- SERVICE_AVAILABILITY_OVERRIDE_FILE: ${expectedReason}`,
      );
      expect(message).not.toContain("/var/lib/atlas-manager/shared.json");
    },
  );

  it("rejects a collision between all persistence paths without exposing the path", () => {
    const sharedPath = "/var/lib/atlas-manager/shared.json";
    let validationError: unknown;

    try {
      parseEnvironment({
        SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE: sharedPath,
        SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: sharedPath,
        SERVICE_AVAILABILITY_OVERRIDE_FILE: sharedPath,
      });
    } catch (error) {
      validationError = error;
    }

    const message = formatEnvironmentValidationError(validationError);

    expect(message).toContain(
      "- SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE: " +
        "must differ from the scheduler cursor file path",
    );
    expect(message).toContain(
      "- SERVICE_AVAILABILITY_OVERRIDE_FILE: " +
        "must differ from the scheduler cursor file path",
    );
    expect(message).toContain(
      "- SERVICE_AVAILABILITY_OVERRIDE_FILE: " +
        "must differ from the occurrence claim file path",
    );
    expect(message).not.toContain(sharedPath);
  });
});
