export const CLI_SCHEMA_VERSION = 1 as const;

export type CliOutputFormat = "human" | "json";

export type CliResult = Readonly<{
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  command: string;
  status: "ok" | "error";
  data?: unknown;
  error?: Readonly<{
    code: string;
    message: string;
  }>;
}>;

export interface AtlasCliTransport {
  execute(
    command: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<unknown>;
}
