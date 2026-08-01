import { isAbsolute } from "node:path";

import { z } from "zod";
import { createCloudflareAccessConfiguration } from "../access-control/domain/cloudflare-access-configuration.js";
import {
  createAdministrativePrincipal,
  type AdministrativePrincipal,
} from "../access-control/domain/administrative-principal.js";
import {
  createAdministrativeRoleCollection,
  type AdministrativeRole,
} from "../access-control/domain/administrative-role.js";
import { roleHasAdministrativePermission } from "../access-control/domain/administrative-operation.js";

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

const persistenceFilePathSchema = z.string().superRefine((value, context) => {
  if (value.length === 0) {
    context.addIssue({
      code: "custom",
      message: "must not be empty",
    });
    return;
  }

  if (value.trim() !== value) {
    context.addIssue({
      code: "custom",
      message: "must not contain surrounding whitespace",
    });
    return;
  }

  if (!isAbsolute(value)) {
    context.addIssue({
      code: "custom",
      message: "must be an absolute path",
    });
  }
});

const cloudflareAccessTeamNameSchema = z
  .string()
  .superRefine((value, context) => {
    if (
      value.length < 1 ||
      value.length > 63 ||
      value.trim() !== value ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(value)
    )
      context.addIssue({
        code: "custom",
        message: "must be a lowercase Cloudflare Access team name",
      });
  });

const cloudflareAccessAudienceSchema = z
  .string()
  .superRefine((value, context) => {
    if (
      value.length < 1 ||
      value.length > 256 ||
      value.trim() !== value ||
      !/^[\x21-\x7e]+$/u.test(value) ||
      value.includes(",") ||
      value.includes('"')
    )
      context.addIssue({
        code: "custom",
        message: "must be one non-empty ASCII audience value",
      });
  });

const administrativeEventHistoryFileSchema = z
  .string()
  .superRefine((value, context) => {
    if (value.length === 0) {
      context.addIssue({ code: "custom", message: "must not be empty" });
      return;
    }
    if (value.trim() !== value)
      context.addIssue({
        code: "custom",
        message: "must not contain surrounding whitespace",
      });
    if (hasControlCharacter(value))
      context.addIssue({
        code: "custom",
        message: "must not contain control characters",
      });
    if (value === "/")
      context.addIssue({
        code: "custom",
        message: "must not be the filesystem root",
      });
    if (!isAbsolute(value))
      context.addIssue({
        code: "custom",
        message: "must be an absolute path",
      });
  });

const administrativeRoleAssignmentsSchema = z
  .string()
  .superRefine((value, context) => {
    if (Buffer.byteLength(value, "utf8") > 16_384) {
      context.addIssue({
        code: "custom",
        message: "must not exceed 16384 UTF-8 bytes",
      });
      return;
    }
    try {
      parseAdministrativeRoleAssignments(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be a valid role-assignment JSON array",
      });
    }
  });

const environmentSchema = z
  .object({
    HOST: z
      .string()
      .min(1, { error: "must not be empty" })
      .default("127.0.0.1"),
    PORT: z.coerce
      .number({ error: "must be a number" })
      .int({ error: "must be an integer" })
      .min(1, { error: "must be between 1 and 65535" })
      .max(65_535, { error: "must be between 1 and 65535" })
      .default(3000),
    LOG_LEVEL: z
      .enum(LOG_LEVELS, {
        error: `must be one of: ${LOG_LEVELS.join(", ")}`,
      })
      .default("info"),
    SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE:
      persistenceFilePathSchema.optional(),
    SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE:
      persistenceFilePathSchema.optional(),
    SERVICE_AVAILABILITY_OVERRIDE_FILE: persistenceFilePathSchema.optional(),
    CLOUDFLARE_ACCESS_TEAM_NAME: cloudflareAccessTeamNameSchema.optional(),
    CLOUDFLARE_ACCESS_AUDIENCE: cloudflareAccessAudienceSchema.optional(),
    ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_EVENT_HISTORY_FILE:
      administrativeEventHistoryFileSchema.optional(),
    ADMINISTRATIVE_ROLE_ASSIGNMENTS:
      administrativeRoleAssignmentsSchema.optional(),
  })
  .superRefine((environment, context) => {
    const hasTeamName = environment.CLOUDFLARE_ACCESS_TEAM_NAME !== undefined;
    const hasAudience = environment.CLOUDFLARE_ACCESS_AUDIENCE !== undefined;
    if (hasTeamName !== hasAudience) {
      context.addIssue({
        code: "custom",
        path: [
          hasTeamName
            ? "CLOUDFLARE_ACCESS_TEAM_NAME"
            : "CLOUDFLARE_ACCESS_AUDIENCE",
        ],
        message: "must be configured together",
      });
    }
    if (
      environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE !==
        undefined &&
      isValidPersistenceFilePath(
        environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE,
      ) &&
      environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE ===
        environment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE"],
        message: "must differ from the scheduler cursor file path",
      });
    }

    if (
      environment.SERVICE_AVAILABILITY_OVERRIDE_FILE !== undefined &&
      isValidPersistenceFilePath(
        environment.SERVICE_AVAILABILITY_OVERRIDE_FILE,
      ) &&
      environment.SERVICE_AVAILABILITY_OVERRIDE_FILE ===
        environment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVICE_AVAILABILITY_OVERRIDE_FILE"],
        message: "must differ from the scheduler cursor file path",
      });
    }

    if (
      environment.SERVICE_AVAILABILITY_OVERRIDE_FILE !== undefined &&
      isValidPersistenceFilePath(
        environment.SERVICE_AVAILABILITY_OVERRIDE_FILE,
      ) &&
      environment.SERVICE_AVAILABILITY_OVERRIDE_FILE ===
        environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVICE_AVAILABILITY_OVERRIDE_FILE"],
        message: "must differ from the occurrence claim file path",
      });
    }

    const eventHistoryHttpEnabled =
      environment.ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED === "true";
    const wakeAlarmHttpEnabled =
      environment.ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED === "true";
    const administrativeHttpEnabled =
      eventHistoryHttpEnabled || wakeAlarmHttpEnabled;
    if (administrativeHttpEnabled) {
      if (environment.HOST !== "127.0.0.1")
        context.addIssue({
          code: "custom",
          path: ["HOST"],
          message: "must be exactly 127.0.0.1 when administration is enabled",
        });
      if (
        environment.CLOUDFLARE_ACCESS_TEAM_NAME === undefined ||
        environment.CLOUDFLARE_ACCESS_AUDIENCE === undefined
      )
        context.addIssue({
          code: "custom",
          path: ["CLOUDFLARE_ACCESS_TEAM_NAME"],
          message: "is required when administration is enabled",
        });
      if (environment.ADMINISTRATIVE_EVENT_HISTORY_FILE === undefined)
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_FILE"],
          message: "is required when administration is enabled",
        });
      if (environment.ADMINISTRATIVE_ROLE_ASSIGNMENTS === undefined)
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
          message: "is required when administration is enabled",
        });
      else {
        try {
          const assignments = parseAdministrativeRoleAssignments(
            environment.ADMINISTRATIVE_ROLE_ASSIGNMENTS,
          );
          if (
            eventHistoryHttpEnabled &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(role, "event_history.read"),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include an auditor or administrator",
            });
          if (
            wakeAlarmHttpEnabled &&
            !assignments.some(
              (assignment) =>
                assignment.roles.includes("power_operator") ||
                assignment.roles.includes("administrator"),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include a power operator or administrator",
            });
        } catch {
          // The field-level schema has already reported the safe category.
        }
      }
    }

    const configuredPaths = [
      environment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE,
      environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE,
      environment.SERVICE_AVAILABILITY_OVERRIDE_FILE,
      environment.ADMINISTRATIVE_EVENT_HISTORY_FILE,
    ].filter((value): value is string => value !== undefined);
    if (
      environment.ADMINISTRATIVE_EVENT_HISTORY_FILE !== undefined &&
      new Set(configuredPaths).size !== configuredPaths.length
    )
      context.addIssue({
        code: "custom",
        path: ["ADMINISTRATIVE_EVENT_HISTORY_FILE"],
        message: "must differ from every other persistence file",
      });
  });

function isValidPersistenceFilePath(value: string): boolean {
  return value.length > 0 && value.trim() === value && isAbsolute(value);
}

export interface EnvironmentConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly serviceAvailabilityReconciliationSchedulerCursorFilePath?: string;
  readonly serviceAvailabilityReconciliationOccurrenceClaimFilePath?: string;
  readonly serviceAvailabilityOverrideFilePath?: string;
  readonly cloudflareAccess?: Readonly<{
    readonly teamName: string;
    readonly issuer: string;
    readonly audience: string;
  }>;
  readonly administrativeEventHistoryHttpEnabled: boolean;
  readonly administrativeWakeAlarmHttpEnabled: boolean;
  readonly administrativeEventHistoryFilePath?: string;
  readonly administrativeRoleAssignments?: readonly AdministrativeRoleAssignment[];
}

export type AdministrativeRoleAssignment = Readonly<{
  principal: AdministrativePrincipal;
  roles: readonly AdministrativeRole[];
}>;

export function parseEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): EnvironmentConfig {
  const parsedEnvironment = environmentSchema.parse(environment);
  const cloudflareAccessConfiguration =
    parsedEnvironment.CLOUDFLARE_ACCESS_TEAM_NAME === undefined ||
    parsedEnvironment.CLOUDFLARE_ACCESS_AUDIENCE === undefined
      ? undefined
      : createCloudflareAccessConfiguration({
          teamName: parsedEnvironment.CLOUDFLARE_ACCESS_TEAM_NAME,
          audience: parsedEnvironment.CLOUDFLARE_ACCESS_AUDIENCE,
        });
  const cloudflareAccess =
    cloudflareAccessConfiguration === undefined
      ? undefined
      : Object.freeze({
          teamName: cloudflareAccessConfiguration.teamName,
          issuer: cloudflareAccessConfiguration.issuer,
          audience: cloudflareAccessConfiguration.audience,
        });
  const administrativeRoleAssignments =
    parsedEnvironment.ADMINISTRATIVE_ROLE_ASSIGNMENTS === undefined
      ? undefined
      : parseAdministrativeRoleAssignments(
          parsedEnvironment.ADMINISTRATIVE_ROLE_ASSIGNMENTS,
        );

  return Object.freeze({
    host: parsedEnvironment.HOST,
    port: parsedEnvironment.PORT,
    logLevel: parsedEnvironment.LOG_LEVEL,
    administrativeEventHistoryHttpEnabled:
      parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED === "true",
    administrativeWakeAlarmHttpEnabled:
      parsedEnvironment.ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED === "true",
    ...(parsedEnvironment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE ===
    undefined
      ? {}
      : {
          serviceAvailabilityReconciliationSchedulerCursorFilePath:
            parsedEnvironment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE,
        }),
    ...(parsedEnvironment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE ===
    undefined
      ? {}
      : {
          serviceAvailabilityReconciliationOccurrenceClaimFilePath:
            parsedEnvironment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE,
        }),
    ...(parsedEnvironment.SERVICE_AVAILABILITY_OVERRIDE_FILE === undefined
      ? {}
      : {
          serviceAvailabilityOverrideFilePath:
            parsedEnvironment.SERVICE_AVAILABILITY_OVERRIDE_FILE,
        }),
    ...(cloudflareAccess === undefined ? {} : { cloudflareAccess }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_FILE === undefined
      ? {}
      : {
          administrativeEventHistoryFilePath:
            parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_FILE,
        }),
    ...(administrativeRoleAssignments === undefined
      ? {}
      : { administrativeRoleAssignments }),
  });
}

export function formatEnvironmentValidationError(
  error: unknown,
): string | undefined {
  if (!(error instanceof z.ZodError)) {
    return undefined;
  }

  const issues = error.issues.map((issue) => {
    const variable = issue.path[0] ?? "environment";

    return `- ${String(variable)}: ${issue.message}`;
  });

  return ["Invalid environment configuration:", ...issues].join("\n");
}

function parseAdministrativeRoleAssignments(
  encoded: string,
): readonly AdministrativeRoleAssignment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded) as unknown;
  } catch {
    throw new Error("Invalid administrative role assignments");
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 32)
    throw new Error("Invalid administrative role assignments");
  const assignments: AdministrativeRoleAssignment[] = [];
  const principalIds = new Set<string>();
  for (const item of parsed) {
    if (!isRecord(item) || Reflect.ownKeys(item).length !== 2)
      throw new Error("Invalid administrative role assignments");
    const principal = createAdministrativePrincipal({
      principalId: item["principalId"],
    });
    if (principalIds.has(principal.principalId))
      throw new Error("Invalid administrative role assignments");
    principalIds.add(principal.principalId);
    const roles = createAdministrativeRoleCollection(item["roles"]);
    assignments.push(Object.freeze({ principal, roles }));
  }
  return Object.freeze(assignments);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
