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
import {
  createMachineOperatingPolicy,
  type MachineOperatingPolicy,
} from "../power-management/domain/machine-operating-policy.js";
import { parseStrictJson } from "./strict-json.js";
import { createBackupTargetCatalogFromEnvironment } from "../backup-management/infrastructure/environment-backup-target-catalog.js";
import { createRetentionPolicy } from "../event-history/domain/event-history-record.js";
import {
  parseAdministrativePublicOrigin,
  type AdministrativePublicOrigin,
} from "../http/administrative-public-origin.js";

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

export const POWER_MANAGEMENT_BACKENDS = ["mock", "linux_helper"] as const;

export type PowerManagementBackend = (typeof POWER_MANAGEMENT_BACKENDS)[number];

export type MachinePowerEffectsActivation =
  | Readonly<{ kind: "disabled" }>
  | Readonly<{
      kind: "linux_helper";
      expectedHelperSha256: string;
    }>;

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

const administrativePublicOriginSchema = z
  .string()
  .superRefine((value, context) => {
    try {
      parseAdministrativePublicOrigin(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be a valid HTTPS administrative origin",
      });
    }
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

const machineOperatingPolicySchema = z
  .string()
  .default('{"mode":"always_on"}')
  .transform((value, context): MachineOperatingPolicy => {
    if (value.length === 0) {
      context.addIssue({ code: "custom", message: "must not be empty" });
      return z.NEVER;
    }
    if (value.trim() !== value) {
      context.addIssue({
        code: "custom",
        message: "must not contain surrounding whitespace",
      });
      return z.NEVER;
    }
    if (Buffer.byteLength(value, "utf8") > 16_384) {
      context.addIssue({
        code: "custom",
        message: "must not exceed 16384 UTF-8 bytes",
      });
      return z.NEVER;
    }
    if (value.charCodeAt(0) === 0xfeff || value.includes("\u0000")) {
      context.addIssue({
        code: "custom",
        message: "must not contain a BOM or NUL",
      });
      return z.NEVER;
    }

    let decoded: unknown;
    try {
      decoded = parseStrictJson(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be valid strict JSON",
      });
      return z.NEVER;
    }
    try {
      return createMachineOperatingPolicy(decoded);
    } catch {
      context.addIssue({
        code: "custom",
        message: "must be a valid machine operating policy",
      });
      return z.NEVER;
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
    POWER_MANAGEMENT_BACKEND: z
      .enum(POWER_MANAGEMENT_BACKENDS, {
        error: "must be exactly mock or linux_helper",
      })
      .default("mock"),
    MACHINE_POWER_SCHEDULER_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    BACKUP_SCHEDULER_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    MACHINE_POWER_EFFECTS_ACTIVATION: z
      .enum(["disabled", "linux_helper"], {
        error: "must be exactly disabled or linux_helper",
      })
      .default("disabled"),
    MACHINE_POWER_EFFECTS_CONFIRMATION: z.string().optional(),
    LINUX_POWER_HELPER_EXPECTED_SHA256: z.string().optional(),
    MACHINE_OPERATING_POLICY: machineOperatingPolicySchema,
    SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE:
      persistenceFilePathSchema.optional(),
    SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE:
      persistenceFilePathSchema.optional(),
    SERVICE_AVAILABILITY_OVERRIDE_FILE: persistenceFilePathSchema.optional(),
    SERVICE_AVAILABILITY_POLICY_FILE: persistenceFilePathSchema.optional(),
    CLOUDFLARE_ACCESS_TEAM_NAME: cloudflareAccessTeamNameSchema.optional(),
    CLOUDFLARE_ACCESS_AUDIENCE: cloudflareAccessAudienceSchema.optional(),
    ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED: z
      .enum(["true", "false"], { error: "must be exactly true or false" })
      .default("false"),
    ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_DASHBOARD_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_BACKUP_HTTP_ENABLED: z
      .enum(["true", "false"], {
        error: "must be exactly true or false",
      })
      .default("false"),
    ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED: z
      .enum(["true", "false"], { error: "must be exactly true or false" })
      .default("false"),
    ADMINISTRATIVE_PUBLIC_ORIGIN: administrativePublicOriginSchema.optional(),
    REGISTERED_BACKUP_TARGETS_JSON: z.string().default("[]"),
    BACKUP_RUN_HISTORY_FILE: persistenceFilePathSchema.optional(),
    BACKUP_SCHEDULER_CURSOR_FILE: persistenceFilePathSchema.optional(),
    BACKUP_OCCURRENCE_CLAIM_FILE: persistenceFilePathSchema.optional(),
    ADMINISTRATIVE_EVENT_HISTORY_FILE:
      administrativeEventHistoryFileSchema.optional(),
    ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY:
      persistenceFilePathSchema.optional(),
    ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS: z.string().optional(),
    ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES: z.string().optional(),
    ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY: z.string().optional(),
    ADMINISTRATIVE_EVENT_HISTORY_AUTOMATIC_RETENTION_ENABLED: z
      .enum(["true", "false"], { error: "must be exactly true or false" })
      .default("false"),
    ADMINISTRATIVE_ROLE_ASSIGNMENTS:
      administrativeRoleAssignmentsSchema.optional(),
    MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
      administrativeEventHistoryFileSchema.optional(),
    MACHINE_POWER_SCHEDULER_CURSOR_FILE:
      administrativeEventHistoryFileSchema.optional(),
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
      environment.SERVICE_AVAILABILITY_POLICY_FILE !== undefined &&
      isValidPersistenceFilePath(
        environment.SERVICE_AVAILABILITY_POLICY_FILE,
      ) &&
      environment.SERVICE_AVAILABILITY_POLICY_FILE ===
        environment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVICE_AVAILABILITY_POLICY_FILE"],
        message: "must differ from the scheduler cursor file path",
      });
    }

    if (
      environment.SERVICE_AVAILABILITY_POLICY_FILE !== undefined &&
      isValidPersistenceFilePath(
        environment.SERVICE_AVAILABILITY_POLICY_FILE,
      ) &&
      environment.SERVICE_AVAILABILITY_POLICY_FILE ===
        environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVICE_AVAILABILITY_POLICY_FILE"],
        message: "must differ from the occurrence claim file path",
      });
    }

    if (
      environment.SERVICE_AVAILABILITY_POLICY_FILE !== undefined &&
      isValidPersistenceFilePath(
        environment.SERVICE_AVAILABILITY_POLICY_FILE,
      ) &&
      environment.SERVICE_AVAILABILITY_POLICY_FILE ===
        environment.SERVICE_AVAILABILITY_OVERRIDE_FILE
    ) {
      context.addIssue({
        code: "custom",
        path: ["SERVICE_AVAILABILITY_POLICY_FILE"],
        message: "must differ from the availability override file path",
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
    const eventHistoryOperationsHttpEnabled =
      environment.ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED ===
      "true";
    const wakeAlarmHttpEnabled =
      environment.ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED === "true";
    const shutdownHttpEnabled =
      environment.ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED === "true";
    const serviceManagementHttpEnabled =
      environment.ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED === "true";
    const serviceAvailabilityHttpEnabled =
      environment.ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED === "true";
    const overviewHttpEnabled =
      environment.ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED === "true";
    const dashboardEnabled =
      environment.ADMINISTRATIVE_DASHBOARD_ENABLED === "true";
    const backupHttpEnabled =
      environment.ADMINISTRATIVE_BACKUP_HTTP_ENABLED === "true";
    const securityStatusHttpEnabled =
      environment.ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED === "true";
    const backupSchedulerEnabled =
      environment.BACKUP_SCHEDULER_ENABLED === "true";
    const administrativeHttpEnabled =
      eventHistoryHttpEnabled ||
      eventHistoryOperationsHttpEnabled ||
      wakeAlarmHttpEnabled ||
      shutdownHttpEnabled ||
      serviceManagementHttpEnabled ||
      serviceAvailabilityHttpEnabled ||
      overviewHttpEnabled ||
      dashboardEnabled ||
      backupHttpEnabled ||
      securityStatusHttpEnabled;
    const effectCapableSurfaceEnabled =
      wakeAlarmHttpEnabled ||
      shutdownHttpEnabled ||
      environment.MACHINE_POWER_SCHEDULER_ENABLED === "true";
    if (environment.POWER_MANAGEMENT_BACKEND === "mock") {
      if (environment.MACHINE_POWER_EFFECTS_ACTIVATION === "linux_helper")
        context.addIssue({
          code: "custom",
          path: ["MACHINE_POWER_EFFECTS_ACTIVATION"],
          message: "linux_helper activation requires the linux_helper backend",
        });
    }
    if (
      environment.POWER_MANAGEMENT_BACKEND === "linux_helper" &&
      effectCapableSurfaceEnabled &&
      environment.MACHINE_POWER_EFFECTS_ACTIVATION === "disabled"
    )
      context.addIssue({
        code: "custom",
        path: ["MACHINE_POWER_EFFECTS_ACTIVATION"],
        message: "must admit Linux power effects for enabled power surfaces",
      });
    if (
      environment.MACHINE_POWER_EFFECTS_ACTIVATION === "linux_helper" &&
      !effectCapableSurfaceEnabled
    )
      context.addIssue({
        code: "custom",
        path: ["MACHINE_POWER_EFFECTS_ACTIVATION"],
        message: "requires at least one enabled power surface",
      });
    if (environment.MACHINE_POWER_EFFECTS_ACTIVATION === "linux_helper") {
      if (
        environment.MACHINE_POWER_EFFECTS_CONFIRMATION !==
        "confirm_linux_helper_power_effects"
      )
        context.addIssue({
          code: "custom",
          path: ["MACHINE_POWER_EFFECTS_CONFIRMATION"],
          message: "must be the exact Linux power-effects confirmation",
        });
      const digest = environment.LINUX_POWER_HELPER_EXPECTED_SHA256;
      if (
        digest === undefined ||
        !/^[0-9a-f]{64}$/u.test(digest) ||
        /^0{64}$/u.test(digest)
      )
        context.addIssue({
          code: "custom",
          path: ["LINUX_POWER_HELPER_EXPECTED_SHA256"],
          message: "must be a nonzero lowercase SHA-256 digest",
        });
    } else {
      if (environment.MACHINE_POWER_EFFECTS_CONFIRMATION !== undefined)
        context.addIssue({
          code: "custom",
          path: ["MACHINE_POWER_EFFECTS_CONFIRMATION"],
          message: "must be omitted when Linux power effects are disabled",
        });
      if (environment.LINUX_POWER_HELPER_EXPECTED_SHA256 !== undefined)
        context.addIssue({
          code: "custom",
          path: ["LINUX_POWER_HELPER_EXPECTED_SHA256"],
          message: "must be omitted when Linux power effects are disabled",
        });
    }
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
      if (environment.ADMINISTRATIVE_PUBLIC_ORIGIN === undefined)
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_PUBLIC_ORIGIN"],
          message: "is required when administration is enabled",
        });
      if (
        environment.ADMINISTRATIVE_EVENT_HISTORY_FILE === undefined &&
        environment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY === undefined
      )
        context.addIssue({
          code: "custom",
          path: [
            eventHistoryOperationsHttpEnabled
              ? "ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY"
              : "ADMINISTRATIVE_EVENT_HISTORY_FILE",
          ],
          message: "is required when administration is enabled",
        });
      if (
        eventHistoryOperationsHttpEnabled &&
        (environment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY === undefined ||
          environment.ADMINISTRATIVE_EVENT_HISTORY_FILE !== undefined)
      )
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY"],
          message:
            "version-two persistence requires one fixed directory and no version-one file",
        });
      if (eventHistoryOperationsHttpEnabled && !eventHistoryHttpEnabled)
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED"],
          message: "must be enabled for operational event-history delivery",
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
            (eventHistoryHttpEnabled || eventHistoryOperationsHttpEnabled) &&
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
          if (
            shutdownHttpEnabled &&
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
          if (
            (serviceManagementHttpEnabled || serviceAvailabilityHttpEnabled) &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(role, "services.read"),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include a service operator or administrator",
            });
          if (
            overviewHttpEnabled &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(role, "operations.read"),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include an operations reader",
            });
          if (
            dashboardEnabled &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(role, "dashboard.read"),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include a dashboard reader",
            });
          if (
            backupHttpEnabled &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(role, "backups.targets.read"),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include a backup reader",
            });
          if (
            eventHistoryOperationsHttpEnabled &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(
                  role,
                  "event_history.integrity.read",
                ),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include an event-history integrity reader",
            });
          if (
            securityStatusHttpEnabled &&
            !assignments.some((assignment) =>
              assignment.roles.some((role) =>
                roleHasAdministrativePermission(role, "security.posture.read"),
              ),
            )
          )
            context.addIssue({
              code: "custom",
              path: ["ADMINISTRATIVE_ROLE_ASSIGNMENTS"],
              message: "must include a security posture reader",
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
      environment.SERVICE_AVAILABILITY_POLICY_FILE,
      environment.ADMINISTRATIVE_EVENT_HISTORY_FILE,
      environment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY,
      environment.MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE,
      environment.MACHINE_POWER_SCHEDULER_CURSOR_FILE,
      environment.BACKUP_RUN_HISTORY_FILE,
      environment.BACKUP_SCHEDULER_CURSOR_FILE,
      environment.BACKUP_OCCURRENCE_CLAIM_FILE,
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
    if (
      eventHistoryOperationsHttpEnabled &&
      environment.ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY !== undefined
    ) {
      try {
        createRetentionPolicy(
          parseStrictJson(
            environment.ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY,
          ),
        );
      } catch {
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY"],
          message: "must be a valid version-two retention policy",
        });
      }
    }
    if (eventHistoryOperationsHttpEnabled) {
      const events =
        environment.ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS;
      const bytes = environment.ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES;
      if (
        events !== undefined &&
        (!/^\d+$/u.test(events) ||
          Number(events) < 100 ||
          Number(events) > 100_000)
      )
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS"],
          message: "must be between 100 and 100000",
        });
      if (
        bytes !== undefined &&
        (!/^\d+$/u.test(bytes) ||
          Number(bytes) < 1_048_576 ||
          Number(bytes) > 67_108_864)
      )
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES"],
          message: "must be between 1048576 and 67108864",
        });
      if (environment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY === undefined)
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY"],
          message: "is required for version-two persistence",
        });
      if (
        environment.ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY === undefined
      )
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY"],
          message: "is required for version-two persistence",
        });
    }
    const servicePersistencePaths = [
      environment.SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE,
      environment.SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE,
      environment.SERVICE_AVAILABILITY_OVERRIDE_FILE,
      environment.SERVICE_AVAILABILITY_POLICY_FILE,
    ].filter((value): value is string => value !== undefined);
    for (const [variable, value] of [
      [
        "MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE",
        environment.MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE,
      ],
      [
        "MACHINE_POWER_SCHEDULER_CURSOR_FILE",
        environment.MACHINE_POWER_SCHEDULER_CURSOR_FILE,
      ],
    ] as const)
      if (value !== undefined && servicePersistencePaths.includes(value))
        context.addIssue({
          code: "custom",
          path: [variable],
          message: "must differ from service-management persistence files",
        });

    const claimFile = environment.MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE;
    const cursorFile = environment.MACHINE_POWER_SCHEDULER_CURSOR_FILE;
    if ((claimFile === undefined) !== (cursorFile === undefined)) {
      context.addIssue({
        code: "custom",
        path: [
          claimFile === undefined
            ? "MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE"
            : "MACHINE_POWER_SCHEDULER_CURSOR_FILE",
        ],
        message: "must be configured together",
      });
    }
    if (
      shutdownHttpEnabled &&
      (claimFile === undefined || cursorFile === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE"],
        message: "is required when shutdown administration is enabled",
      });
    }
    if (
      claimFile !== undefined &&
      cursorFile !== undefined &&
      claimFile === cursorFile &&
      isValidPersistenceFilePath(claimFile)
    )
      context.addIssue({
        code: "custom",
        path: ["MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE"],
        message: "must differ from the scheduler cursor file path",
      });

    if (environment.MACHINE_POWER_SCHEDULER_ENABLED === "true") {
      if (environment.MACHINE_POWER_SCHEDULER_CURSOR_FILE === undefined)
        context.addIssue({
          code: "custom",
          path: ["MACHINE_POWER_SCHEDULER_CURSOR_FILE"],
          message: "is required when the machine-power scheduler is enabled",
        });
      if (environment.MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE === undefined)
        context.addIssue({
          code: "custom",
          path: ["MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE"],
          message: "is required when the machine-power scheduler is enabled",
        });
      if (
        environment.ADMINISTRATIVE_EVENT_HISTORY_FILE === undefined &&
        environment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY === undefined
      )
        context.addIssue({
          code: "custom",
          path: ["ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY"],
          message: "is required when the machine-power scheduler is enabled",
        });
    }
    if (backupHttpEnabled && environment.BACKUP_RUN_HISTORY_FILE === undefined)
      context.addIssue({
        code: "custom",
        path: ["BACKUP_RUN_HISTORY_FILE"],
        message: "is required when backup administration is enabled",
      });
    if (backupSchedulerEnabled) {
      if (environment.BACKUP_RUN_HISTORY_FILE === undefined)
        context.addIssue({
          code: "custom",
          path: ["BACKUP_RUN_HISTORY_FILE"],
          message: "is required when backup scheduling is enabled",
        });
      if (environment.BACKUP_SCHEDULER_CURSOR_FILE === undefined)
        context.addIssue({
          code: "custom",
          path: ["BACKUP_SCHEDULER_CURSOR_FILE"],
          message: "is required when backup scheduling is enabled",
        });
      if (environment.BACKUP_OCCURRENCE_CLAIM_FILE === undefined)
        context.addIssue({
          code: "custom",
          path: ["BACKUP_OCCURRENCE_CLAIM_FILE"],
          message: "is required when backup scheduling is enabled",
        });
      try {
        const targets =
          createBackupTargetCatalogFromEnvironment(environment).list();
        if (!targets.some((target) => target.schedule.mode === "scheduled"))
          context.addIssue({
            code: "custom",
            path: ["REGISTERED_BACKUP_TARGETS_JSON"],
            message: "must include a scheduled backup target",
          });
      } catch {
        /* the field is reported by parseEnvironment */
      }
    }
    if (backupHttpEnabled) {
      try {
        createBackupTargetCatalogFromEnvironment(environment);
      } catch {
        context.addIssue({
          code: "custom",
          path: ["REGISTERED_BACKUP_TARGETS_JSON"],
          message: "must be a valid backup target catalog",
        });
      }
    }
  });

function isValidPersistenceFilePath(value: string): boolean {
  return value.length > 0 && value.trim() === value && isAbsolute(value);
}

export interface EnvironmentConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly powerManagementBackend: PowerManagementBackend;
  readonly machinePowerEffectsActivation: MachinePowerEffectsActivation;
  readonly machinePowerSchedulerEnabled: boolean;
  readonly machineOperatingPolicy: MachineOperatingPolicy;
  readonly serviceAvailabilityReconciliationSchedulerCursorFilePath?: string;
  readonly serviceAvailabilityReconciliationOccurrenceClaimFilePath?: string;
  readonly serviceAvailabilityOverrideFilePath?: string;
  readonly serviceAvailabilityPolicyFilePath?: string;
  readonly cloudflareAccess?: Readonly<{
    readonly teamName: string;
    readonly issuer: string;
    readonly audience: string;
  }>;
  readonly administrativeEventHistoryHttpEnabled: boolean;
  readonly administrativePublicOrigin?: AdministrativePublicOrigin;
  readonly administrativeSecurityStatusHttpEnabled?: boolean;
  readonly administrativeEventHistoryOperationsHttpEnabled?: boolean;
  readonly administrativeWakeAlarmHttpEnabled: boolean;
  readonly administrativeShutdownHttpEnabled: boolean;
  readonly administrativeServiceManagementHttpEnabled?: boolean;
  readonly administrativeServiceAvailabilityHttpEnabled?: boolean;
  readonly administrativeOverviewHttpEnabled?: boolean;
  readonly administrativeDashboardEnabled?: boolean;
  readonly administrativeBackupHttpEnabled?: boolean;
  readonly backupSchedulerEnabled?: boolean;
  readonly registeredBackupTargets?: ReturnType<
    typeof createBackupTargetCatalogFromEnvironment
  >;
  readonly backupRunHistoryFilePath?: string;
  readonly backupSchedulerCursorFilePath?: string;
  readonly backupOccurrenceClaimFilePath?: string;
  readonly administrativeEventHistoryFilePath?: string;
  readonly administrativeEventHistoryDirectoryPath?: string;
  readonly administrativeEventHistoryMaxSegmentEvents?: number;
  readonly administrativeEventHistoryMaxSegmentBytes?: number;
  readonly administrativeEventHistoryRetentionPolicy?: unknown;
  readonly administrativeEventHistoryAutomaticRetentionEnabled?: boolean;
  readonly administrativeRoleAssignments?: readonly AdministrativeRoleAssignment[];
  readonly machineShutdownOccurrenceClaimFilePath?: string;
  readonly machinePowerSchedulerCursorFilePath?: string;
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
  const administrativePublicOrigin =
    parsedEnvironment.ADMINISTRATIVE_PUBLIC_ORIGIN === undefined
      ? undefined
      : parseAdministrativePublicOrigin(
          parsedEnvironment.ADMINISTRATIVE_PUBLIC_ORIGIN,
        );
  const administrativeRoleAssignments =
    parsedEnvironment.ADMINISTRATIVE_ROLE_ASSIGNMENTS === undefined
      ? undefined
      : parseAdministrativeRoleAssignments(
          parsedEnvironment.ADMINISTRATIVE_ROLE_ASSIGNMENTS,
        );
  const registeredBackupTargets =
    createBackupTargetCatalogFromEnvironment(parsedEnvironment);
  const backupConfigurationProvided =
    Object.hasOwn(environment, "BACKUP_SCHEDULER_ENABLED") ||
    Object.hasOwn(environment, "REGISTERED_BACKUP_TARGETS_JSON") ||
    Object.hasOwn(environment, "ADMINISTRATIVE_BACKUP_HTTP_ENABLED") ||
    Object.hasOwn(environment, "BACKUP_RUN_HISTORY_FILE");

  return Object.freeze({
    host: parsedEnvironment.HOST,
    port: parsedEnvironment.PORT,
    logLevel: parsedEnvironment.LOG_LEVEL,
    powerManagementBackend: parsedEnvironment.POWER_MANAGEMENT_BACKEND,
    machinePowerEffectsActivation:
      parsedEnvironment.MACHINE_POWER_EFFECTS_ACTIVATION === "disabled"
        ? Object.freeze({ kind: "disabled" as const })
        : Object.freeze({
            kind: "linux_helper" as const,
            expectedHelperSha256:
              parsedEnvironment.LINUX_POWER_HELPER_EXPECTED_SHA256!,
          }),
    machinePowerSchedulerEnabled:
      parsedEnvironment.MACHINE_POWER_SCHEDULER_ENABLED === "true",
    machineOperatingPolicy: parsedEnvironment.MACHINE_OPERATING_POLICY,
    administrativeEventHistoryHttpEnabled:
      parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED === "true",
    ...(administrativePublicOrigin === undefined
      ? {}
      : { administrativePublicOrigin }),
    ...(parsedEnvironment.ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED === "true"
      ? { administrativeSecurityStatusHttpEnabled: true }
      : {}),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED ===
    "true"
      ? { administrativeEventHistoryOperationsHttpEnabled: true }
      : {}),
    administrativeWakeAlarmHttpEnabled:
      parsedEnvironment.ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED === "true",
    administrativeShutdownHttpEnabled:
      parsedEnvironment.ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED === "true",
    ...(parsedEnvironment.ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED ===
    "true"
      ? { administrativeServiceManagementHttpEnabled: true }
      : {}),
    ...(parsedEnvironment.ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED ===
    "true"
      ? { administrativeServiceAvailabilityHttpEnabled: true }
      : {}),
    ...(parsedEnvironment.ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED === "true"
      ? { administrativeOverviewHttpEnabled: true }
      : {}),
    ...(parsedEnvironment.ADMINISTRATIVE_DASHBOARD_ENABLED === "true"
      ? { administrativeDashboardEnabled: true }
      : {}),
    ...(parsedEnvironment.ADMINISTRATIVE_BACKUP_HTTP_ENABLED === "true"
      ? { administrativeBackupHttpEnabled: true }
      : {}),
    ...(backupConfigurationProvided
      ? {
          backupSchedulerEnabled:
            parsedEnvironment.BACKUP_SCHEDULER_ENABLED === "true",
          registeredBackupTargets,
          ...(parsedEnvironment.BACKUP_RUN_HISTORY_FILE === undefined
            ? {}
            : {
                backupRunHistoryFilePath:
                  parsedEnvironment.BACKUP_RUN_HISTORY_FILE,
              }),
          ...(parsedEnvironment.BACKUP_SCHEDULER_CURSOR_FILE === undefined
            ? {}
            : {
                backupSchedulerCursorFilePath:
                  parsedEnvironment.BACKUP_SCHEDULER_CURSOR_FILE,
              }),
          ...(parsedEnvironment.BACKUP_OCCURRENCE_CLAIM_FILE === undefined
            ? {}
            : {
                backupOccurrenceClaimFilePath:
                  parsedEnvironment.BACKUP_OCCURRENCE_CLAIM_FILE,
              }),
        }
      : {}),
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
    ...(parsedEnvironment.SERVICE_AVAILABILITY_POLICY_FILE === undefined
      ? {}
      : {
          serviceAvailabilityPolicyFilePath:
            parsedEnvironment.SERVICE_AVAILABILITY_POLICY_FILE,
        }),
    ...(cloudflareAccess === undefined ? {} : { cloudflareAccess }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_FILE === undefined
      ? {}
      : {
          administrativeEventHistoryFilePath:
            parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_FILE,
        }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY === undefined
      ? {}
      : {
          administrativeEventHistoryDirectoryPath:
            parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_DIRECTORY,
        }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS ===
    undefined
      ? {}
      : {
          administrativeEventHistoryMaxSegmentEvents: Number(
            parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_EVENTS,
          ),
        }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES ===
    undefined
      ? {}
      : {
          administrativeEventHistoryMaxSegmentBytes: Number(
            parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_MAX_SEGMENT_BYTES,
          ),
        }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY ===
    undefined
      ? {}
      : {
          administrativeEventHistoryRetentionPolicy: parseStrictJson(
            parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_RETENTION_POLICY,
          ),
        }),
    ...(parsedEnvironment.ADMINISTRATIVE_EVENT_HISTORY_AUTOMATIC_RETENTION_ENABLED ===
    "true"
      ? { administrativeEventHistoryAutomaticRetentionEnabled: true }
      : {}),
    ...(administrativeRoleAssignments === undefined
      ? {}
      : { administrativeRoleAssignments }),
    ...(parsedEnvironment.MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE === undefined
      ? {}
      : {
          machineShutdownOccurrenceClaimFilePath:
            parsedEnvironment.MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE,
        }),
    ...(parsedEnvironment.MACHINE_POWER_SCHEDULER_CURSOR_FILE === undefined
      ? {}
      : {
          machinePowerSchedulerCursorFilePath:
            parsedEnvironment.MACHINE_POWER_SCHEDULER_CURSOR_FILE,
        }),
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
