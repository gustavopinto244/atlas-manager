import { describe, expect, it } from "vitest";

import {
  formatEnvironmentValidationError,
  LOG_LEVELS,
  parseEnvironment,
} from "../../src/config/environment.js";

describe("parseEnvironment", () => {
  const scheduledPolicy = {
    mode: "scheduled",
    timezone: "America/Sao_Paulo",
    weeklySchedule: {
      windows: [
        { dayOfWeek: "monday", start: "08:00", end: "22:00" },
        { dayOfWeek: "tuesday", start: "08:00", end: "22:00" },
      ],
    },
  };

  it("defaults the machine operating policy to immutable always-on", () => {
    const config = parseEnvironment({});
    expect(config.machineOperatingPolicy).toEqual({ mode: "always_on" });
    expect(Object.isFrozen(config.machineOperatingPolicy)).toBe(true);
  });

  it("defaults the machine-power scheduler to disabled", () => {
    const config = parseEnvironment({});
    expect(config.machinePowerSchedulerEnabled).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each([
    ["false", false],
    ["true", true],
  ] as const)("accepts the exact scheduler flag %s", (value, expected) => {
    const config = parseEnvironment({
      MACHINE_POWER_SCHEDULER_ENABLED: value,
      MACHINE_POWER_SCHEDULER_CURSOR_FILE:
        "/var/lib/atlas-manager/power-cursor.json",
      MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
        "/var/lib/atlas-manager/power-claims.json",
      ADMINISTRATIVE_EVENT_HISTORY_FILE: "/var/lib/atlas-manager/events.jsonl",
    });

    expect(config.machinePowerSchedulerEnabled).toBe(expected);
  });

  it.each([
    "TRUE",
    "FALSE",
    "True",
    "False",
    "1",
    "0",
    "yes",
    "no",
    "enabled",
    "disabled",
    "",
    " true",
    "false ",
    "unknown",
  ])("rejects non-canonical scheduler flag %s", (value) => {
    expect(() =>
      parseEnvironment({ MACHINE_POWER_SCHEDULER_ENABLED: value }),
    ).toThrow();
  });

  it("requires all persistent scheduler files only when enabled", () => {
    expect(() =>
      parseEnvironment({ MACHINE_POWER_SCHEDULER_ENABLED: "true" }),
    ).toThrow();

    expect(
      parseEnvironment({ MACHINE_POWER_SCHEDULER_ENABLED: "false" })
        .machinePowerSchedulerEnabled,
    ).toBe(false);
  });

  it("does not enable the scheduler because a scheduled policy is configured", () => {
    const config = parseEnvironment({
      MACHINE_OPERATING_POLICY: JSON.stringify(scheduledPolicy),
    });

    expect(config.machineOperatingPolicy.mode).toBe("scheduled");
    expect(config.machinePowerSchedulerEnabled).toBe(false);
  });

  it("defaults Linux power-effects activation to an immutable disabled state", () => {
    const config = parseEnvironment({});

    expect(config.machinePowerEffectsActivation).toEqual({ kind: "disabled" });
    expect(Object.isFrozen(config.machinePowerEffectsActivation)).toBe(true);
  });

  it("accepts exact Linux activation only with confirmation and a digest", () => {
    const config = parseEnvironment({
      POWER_MANAGEMENT_BACKEND: "linux_helper",
      MACHINE_POWER_SCHEDULER_ENABLED: "true",
      MACHINE_POWER_SCHEDULER_CURSOR_FILE:
        "/var/lib/atlas-manager/power-cursor.json",
      MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
        "/var/lib/atlas-manager/power-claims.json",
      ADMINISTRATIVE_EVENT_HISTORY_FILE: "/var/lib/atlas-manager/events.jsonl",
      MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
      MACHINE_POWER_EFFECTS_CONFIRMATION: "confirm_linux_helper_power_effects",
      LINUX_POWER_HELPER_EXPECTED_SHA256: "a".repeat(64),
    });

    expect(config.machinePowerEffectsActivation).toEqual({
      kind: "linux_helper",
      expectedHelperSha256: "a".repeat(64),
    });
    expect(Object.isFrozen(config.machinePowerEffectsActivation)).toBe(true);
    expect(Object.keys(config)).not.toContain(
      "MACHINE_POWER_EFFECTS_CONFIRMATION",
    );
    expect(JSON.stringify(config)).not.toContain(
      "confirm_linux_helper_power_effects",
    );
  });

  it.each([
    "DISABLED",
    "LINUX_HELPER",
    "linux-helper",
    "armed",
    "enabled",
    "true",
    "false",
    "1",
    "0",
    "",
    " disabled",
    "linux_helper ",
    "unknown",
  ])("rejects non-canonical activation value %s", (value) => {
    expect(() =>
      parseEnvironment({ MACHINE_POWER_EFFECTS_ACTIVATION: value }),
    ).toThrow();
  });

  it.each([
    undefined,
    "confirm_linux_helper_power_effects ",
    "Confirm_linux_helper_power_effects",
    "confirm_linux_helper_power",
  ])("rejects invalid Linux activation confirmation", (confirmation) => {
    expect(() =>
      parseEnvironment({
        POWER_MANAGEMENT_BACKEND: "linux_helper",
        ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: "true",
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
        MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
        ...(confirmation === undefined
          ? {}
          : { MACHINE_POWER_EFFECTS_CONFIRMATION: confirmation }),
        LINUX_POWER_HELPER_EXPECTED_SHA256: "a".repeat(64),
      }),
    ).toThrow();
  });

  it.each([
    "A".repeat(64),
    "sha256:" + "a".repeat(64),
    "a".repeat(63),
    "a".repeat(65),
    "0".repeat(64),
  ])("rejects invalid expected helper digest", (digest) => {
    expect(() =>
      parseEnvironment({
        POWER_MANAGEMENT_BACKEND: "linux_helper",
        MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
        MACHINE_POWER_EFFECTS_CONFIRMATION:
          "confirm_linux_helper_power_effects",
        LINUX_POWER_HELPER_EXPECTED_SHA256: digest,
        MACHINE_POWER_SCHEDULER_ENABLED: "true",
        MACHINE_POWER_SCHEDULER_CURSOR_FILE:
          "/var/lib/atlas-manager/power-cursor.json",
        MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
          "/var/lib/atlas-manager/power-claims.json",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/events.jsonl",
      }),
    ).toThrow();
  });

  it("rejects contradictory activation values and preserves inert Linux selection", () => {
    expect(() =>
      parseEnvironment({
        POWER_MANAGEMENT_BACKEND: "mock",
        MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
        MACHINE_POWER_EFFECTS_CONFIRMATION:
          "confirm_linux_helper_power_effects",
        LINUX_POWER_HELPER_EXPECTED_SHA256: "a".repeat(64),
      }),
    ).toThrow();

    const inert = parseEnvironment({
      POWER_MANAGEMENT_BACKEND: "linux_helper",
      MACHINE_POWER_EFFECTS_ACTIVATION: "disabled",
    });
    expect(inert.machinePowerEffectsActivation).toEqual({ kind: "disabled" });
  });

  it("rejects Linux effects without activation or without an effect surface", () => {
    expect(() =>
      parseEnvironment({
        POWER_MANAGEMENT_BACKEND: "linux_helper",
        MACHINE_POWER_SCHEDULER_ENABLED: "true",
        MACHINE_POWER_SCHEDULER_CURSOR_FILE:
          "/var/lib/atlas-manager/power-cursor.json",
        MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
          "/var/lib/atlas-manager/power-claims.json",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/events.jsonl",
      }),
    ).toThrow();

    expect(() =>
      parseEnvironment({
        POWER_MANAGEMENT_BACKEND: "linux_helper",
        MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
        MACHINE_POWER_EFFECTS_CONFIRMATION:
          "confirm_linux_helper_power_effects",
        LINUX_POWER_HELPER_EXPECTED_SHA256: "a".repeat(64),
      }),
    ).toThrow();
  });

  it.each([{ mode: "always_on" }, { mode: "manual" }, scheduledPolicy])(
    "accepts a strict machine operating policy",
    (policy) => {
      const config = parseEnvironment({
        MACHINE_OPERATING_POLICY: JSON.stringify(policy),
      });
      expect(config.machineOperatingPolicy).toEqual(policy);
    },
  );

  it("accepts the exact 16384-byte policy boundary", () => {
    const compact = '{"mode":"always_on"}';
    const policy = "{" + " ".repeat(16_384 - compact.length) + compact.slice(1);
    expect(Buffer.byteLength(policy, "utf8")).toBe(16_384);
    expect(
      parseEnvironment({ MACHINE_OPERATING_POLICY: policy })
        .machineOperatingPolicy,
    ).toEqual({
      mode: "always_on",
    });
  });

  it.each([
    ["empty", ""],
    ["whitespace-only", "   \n\t"],
    ["surrounding whitespace", ' {"mode":"always_on"}'],
    ["BOM", '\ufeff{"mode":"always_on"}'],
    ["NUL", '{"mode":"always_on"}\u0000'],
    ["malformed JSON", '{"mode":"always_on"'],
    ["trailing bytes", '{"mode":"always_on"} trailing'],
    ["multiple roots", '{"mode":"always_on"}{"mode":"manual"}'],
    ["primitive root", '"always_on"'],
    ["array root", "[]"],
    ["duplicate root field", '{"mode":"always_on","mode":"manual"}'],
    [
      "duplicate nested field",
      '{"mode":"scheduled","timezone":"America/Sao_Paulo","weeklySchedule":{"windows":[],"windows":[]}}',
    ],
    ["unknown field", '{"mode":"always_on","unexpected":true}'],
    [
      "unknown nested field",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: scheduledPolicy.weeklySchedule.windows,
          unexpected: true,
        },
      }),
    ],
    ["invalid mode", '{"mode":"Always_On"}'],
    [
      "invalid timezone",
      JSON.stringify({ ...scheduledPolicy, timezone: "UTC" }),
    ],
    [
      "empty windows",
      JSON.stringify({ ...scheduledPolicy, weeklySchedule: { windows: [] } }),
    ],
    [
      "excessive windows",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: Array.from({ length: 65 }, (_, index) => ({
            dayOfWeek: [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ][index % 7],
            start: `${String(Math.floor(index / 7) * 2).padStart(2, "0")}:00`,
            end: `${String(Math.floor(index / 7) * 2 + 1).padStart(2, "0")}:00`,
          })),
        },
      }),
    ],
    [
      "invalid weekday",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: [{ dayOfWeek: "Monday", start: "08:00", end: "22:00" }],
        },
      }),
    ],
    [
      "invalid local time",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: [{ dayOfWeek: "monday", start: "8:00", end: "22:00" }],
        },
      }),
    ],
    [
      "zero-length window",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: [{ dayOfWeek: "monday", start: "08:00", end: "08:00" }],
        },
      }),
    ],
    [
      "reversed window",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: [{ dayOfWeek: "monday", start: "22:00", end: "08:00" }],
        },
      }),
    ],
    [
      "duplicate window",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: [
            { dayOfWeek: "monday", start: "08:00", end: "22:00" },
            { dayOfWeek: "monday", start: "08:00", end: "22:00" },
          ],
        },
      }),
    ],
    [
      "overlapping window",
      JSON.stringify({
        ...scheduledPolicy,
        weeklySchedule: {
          windows: [
            { dayOfWeek: "monday", start: "08:00", end: "12:00" },
            { dayOfWeek: "monday", start: "11:00", end: "22:00" },
          ],
        },
      }),
    ],
  ] as const)("rejects invalid machine policy: %s", (_label, value) => {
    expect(() =>
      parseEnvironment({ MACHINE_OPERATING_POLICY: value }),
    ).toThrow();
  });

  it("rejects a policy larger than 16384 UTF-8 bytes", () => {
    const compact = '{"mode":"always_on"}';
    const policy = "{" + " ".repeat(16_385 - compact.length) + compact.slice(1);
    expect(Buffer.byteLength(policy, "utf8")).toBe(16_385);
    expect(() =>
      parseEnvironment({ MACHINE_OPERATING_POLICY: policy }),
    ).toThrow();
  });

  it("canonicalizes windows independently of input order and isolates input", () => {
    const input = {
      ...scheduledPolicy,
      weeklySchedule: {
        windows: [
          { dayOfWeek: "tuesday", start: "08:00", end: "22:00" },
          { dayOfWeek: "monday", start: "08:00", end: "22:00" },
        ],
      },
    };
    const config = parseEnvironment({
      MACHINE_OPERATING_POLICY: JSON.stringify(input),
    });
    input.weeklySchedule.windows[0]!.start = "09:00";

    expect(config.machineOperatingPolicy).toEqual({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [
          { dayOfWeek: "monday", start: "08:00", end: "22:00" },
          { dayOfWeek: "tuesday", start: "08:00", end: "22:00" },
        ],
      },
    });
    if (config.machineOperatingPolicy.mode !== "scheduled") {
      throw new Error("Expected a scheduled policy");
    }
    expect(Object.isFrozen(config.machineOperatingPolicy.weeklySchedule)).toBe(
      true,
    );
    expect(
      Object.isFrozen(config.machineOperatingPolicy.weeklySchedule.windows),
    ).toBe(true);
  });

  it("does not echo raw policy JSON in a safe validation error", () => {
    const raw = '{"mode":"scheduled","secret":"do-not-echo"}';
    try {
      parseEnvironment({ MACHINE_OPERATING_POLICY: raw });
      throw new Error("expected configuration validation to fail");
    } catch (error) {
      const message = formatEnvironmentValidationError(error);
      expect(message).toContain("MACHINE_OPERATING_POLICY");
      expect(message).not.toContain(raw);
      expect(message).not.toContain("do-not-echo");
    }
  });

  it("defaults power management to the mock backend", () => {
    const config = parseEnvironment({});
    expect(config.powerManagementBackend).toBe("mock");
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("accepts only the exact Linux helper backend value", () => {
    expect(
      parseEnvironment({ POWER_MANAGEMENT_BACKEND: "linux_helper" })
        .powerManagementBackend,
    ).toBe("linux_helper");
  });

  it.each([
    "",
    "Mock",
    "LINUX_HELPER",
    "linux-helper",
    "linux",
    "helper",
    "real",
    "production",
    "true",
    "false",
    " mock",
    "mock ",
  ])("rejects invalid power-management backend %s", (value) => {
    expect(() =>
      parseEnvironment({ POWER_MANAGEMENT_BACKEND: value }),
    ).toThrow();
  });

  it("keeps administrative event-history HTTP disabled by default", () => {
    expect(parseEnvironment({}).administrativeEventHistoryHttpEnabled).toBe(
      false,
    );
  });

  it("keeps wake-alarm HTTP disabled by default", () => {
    expect(parseEnvironment({}).administrativeWakeAlarmHttpEnabled).toBe(false);
  });

  it("keeps shutdown HTTP disabled by default", () => {
    expect(parseEnvironment({}).administrativeShutdownHttpEnabled).toBe(false);
  });

  it.each(["1", "0", "yes", "no", "TRUE", "False", "", " true"])(
    "rejects non-canonical wake-alarm HTTP boolean %s",
    (enabled) => {
      expect(() =>
        parseEnvironment({ ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: enabled }),
      ).toThrow();
    },
  );

  it.each(["1", "0", "yes", "no", "TRUE", "False", "", " true"])(
    "rejects non-canonical shutdown HTTP boolean %s",
    (enabled) => {
      expect(() =>
        parseEnvironment({ ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: enabled }),
      ).toThrow();
    },
  );

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
      ADMINISTRATIVE_PUBLIC_ORIGIN: "https://atlas.example.com",
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
          kind: "human",
        },
        roles: ["auditor"],
      },
    ]);
  });

  it("accepts wake-alarm HTTP independently with a power operator", () => {
    const config = parseEnvironment({
      HOST: "127.0.0.1",
      CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
      CLOUDFLARE_ACCESS_AUDIENCE: "atlas-admin",
      ADMINISTRATIVE_PUBLIC_ORIGIN: "https://atlas.example.com",
      ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: "true",
      ADMINISTRATIVE_EVENT_HISTORY_FILE:
        "/var/lib/atlas-manager/admin-events.jsonl",
      ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
        {
          principalId: "00000000-0000-4000-8000-000000000001",
          roles: ["power_operator"],
        },
      ]),
    });
    expect(config.administrativeWakeAlarmHttpEnabled).toBe(true);
    expect(config.administrativeEventHistoryHttpEnabled).toBe(false);
  });

  it("requires a power-capable role when wake-alarm HTTP is enabled", () => {
    expect(() =>
      parseEnvironment({
        HOST: "127.0.0.1",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "atlas-admin",
        ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: "true",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/admin-events.jsonl",
        ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
          {
            principalId: "00000000-0000-4000-8000-000000000001",
            roles: ["auditor"],
          },
        ]),
      }),
    ).toThrow();
  });

  it("accepts shutdown HTTP only with persistent power state and a power role", () => {
    const config = parseEnvironment({
      HOST: "127.0.0.1",
      CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
      CLOUDFLARE_ACCESS_AUDIENCE: "atlas-admin",
      ADMINISTRATIVE_PUBLIC_ORIGIN: "https://atlas.example.com",
      ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: "true",
      ADMINISTRATIVE_EVENT_HISTORY_FILE:
        "/var/lib/atlas-manager/admin-events.jsonl",
      ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
        {
          principalId: "00000000-0000-4000-8000-000000000001",
          roles: ["power_operator"],
        },
      ]),
      MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
        "/var/lib/atlas-manager/shutdown-claims.json",
      MACHINE_POWER_SCHEDULER_CURSOR_FILE:
        "/var/lib/atlas-manager/shutdown-cursor.json",
    });
    expect(config.administrativeShutdownHttpEnabled).toBe(true);
    expect(config.machineShutdownOccurrenceClaimFilePath).toBe(
      "/var/lib/atlas-manager/shutdown-claims.json",
    );
    expect(config.machinePowerSchedulerCursorFilePath).toBe(
      "/var/lib/atlas-manager/shutdown-cursor.json",
    );
  });

  it("rejects shutdown activation without paired persistent power state", () => {
    expect(() =>
      parseEnvironment({
        HOST: "127.0.0.1",
        CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
        CLOUDFLARE_ACCESS_AUDIENCE: "atlas-admin",
        ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: "true",
        ADMINISTRATIVE_EVENT_HISTORY_FILE:
          "/var/lib/atlas-manager/admin-events.jsonl",
        ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
          {
            principalId: "00000000-0000-4000-8000-000000000001",
            roles: ["administrator"],
          },
        ]),
        MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
          "/var/lib/atlas-manager/shutdown-claims.json",
      }),
    ).toThrow();
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
      powerManagementBackend: "mock",
      machinePowerEffectsActivation: { kind: "disabled" },
      machinePowerSchedulerEnabled: false,
      machineOperatingPolicy: { mode: "always_on" },
      administrativeEventHistoryHttpEnabled: false,
      administrativeWakeAlarmHttpEnabled: false,
      administrativeShutdownHttpEnabled: false,
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
      powerManagementBackend: "mock",
      machinePowerEffectsActivation: { kind: "disabled" },
      machinePowerSchedulerEnabled: false,
      machineOperatingPolicy: { mode: "always_on" },
      administrativeEventHistoryHttpEnabled: false,
      administrativeWakeAlarmHttpEnabled: false,
      administrativeShutdownHttpEnabled: false,
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
