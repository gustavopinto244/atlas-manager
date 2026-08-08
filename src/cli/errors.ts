export const CLI_EXIT_CODES = Object.freeze({
  success: 0,
  operationalFailure: 1,
  invalidArguments: 2,
  accessDenied: 3,
  conflict: 4,
  partialFailure: 5,
  interrupted: 130,
} as const);

export type CliErrorCode =
  | "invalid_arguments"
  | "unknown_command"
  | "administrative_access_denied"
  | "infrastructure_unavailable"
  | "service_not_found"
  | "service_operation_failed"
  | "schedule_invalid"
  | "operation_conflict"
  | "command_not_implemented";

export class AtlasCliError extends Error {
  public override readonly name = "AtlasCliError";

  public constructor(
    public readonly code: CliErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function exitCodeForCliError(error: AtlasCliError): number {
  switch (error.code) {
    case "invalid_arguments":
    case "unknown_command":
    case "command_not_implemented":
      return CLI_EXIT_CODES.invalidArguments;
    case "administrative_access_denied":
      return CLI_EXIT_CODES.accessDenied;
    case "operation_conflict":
      return CLI_EXIT_CODES.conflict;
    case "infrastructure_unavailable":
      return CLI_EXIT_CODES.partialFailure;
    case "service_not_found":
    case "service_operation_failed":
    case "schedule_invalid":
      return CLI_EXIT_CODES.operationalFailure;
  }
}
