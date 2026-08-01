import { isAbsolute } from "node:path";

import { z } from "zod";
import { createCloudflareAccessConfiguration } from "../access-control/domain/cloudflare-access-configuration.js";

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

const environmentSchema = z
  .object({
    HOST: z
      .string()
      .trim()
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
}

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

  return {
    host: parsedEnvironment.HOST,
    port: parsedEnvironment.PORT,
    logLevel: parsedEnvironment.LOG_LEVEL,
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
    ...(cloudflareAccessConfiguration === undefined
      ? {}
      : {
          cloudflareAccess: {
            teamName: cloudflareAccessConfiguration.teamName,
            issuer: cloudflareAccessConfiguration.issuer,
            audience: cloudflareAccessConfiguration.audience,
          },
        }),
  };
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
