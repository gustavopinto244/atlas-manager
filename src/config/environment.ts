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
});

export interface EnvironmentConfig {
  host: string;
  port: number;
  logLevel: LogLevel;
}

export function parseEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): EnvironmentConfig {
  const parsedEnvironment = environmentSchema.parse(environment);

  return {
    host: parsedEnvironment.HOST,
    port: parsedEnvironment.PORT,
    logLevel: parsedEnvironment.LOG_LEVEL,
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
