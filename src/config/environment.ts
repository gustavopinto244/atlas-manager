import { isAbsolute } from "node:path";

import { z } from "zod";

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

const schedulerCursorFilePathSchema = z
  .string()
  .superRefine((value, context) => {
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

const environmentSchema = z.object({
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
    schedulerCursorFilePathSchema.optional(),
});

export interface EnvironmentConfig {
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly serviceAvailabilityReconciliationSchedulerCursorFilePath?: string;
}

export function parseEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): EnvironmentConfig {
  const parsedEnvironment = environmentSchema.parse(environment);

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
