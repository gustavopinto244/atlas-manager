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
  | "service_operation_unsupported"
  | "schedule_invalid"
  | "operation_conflict"
  | "insecure_transport"
  | "mutation_outcome_unknown"
  | "mutation_interrupted_outcome_unknown"
  | "interrupted"
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
    case "insecure_transport":
      return CLI_EXIT_CODES.invalidArguments;
    case "administrative_access_denied":
      return CLI_EXIT_CODES.accessDenied;
    case "operation_conflict":
      return CLI_EXIT_CODES.conflict;
    // A lost or timed-out mutation response is not evidence that the mutation
    // failed, so it must not share an exit code with definite failure. It is
    // reported with the same partial/indeterminate code as an unreachable
    // endpoint, and the message directs the operator to re-read authoritative
    // state.
    case "infrastructure_unavailable":
    case "mutation_outcome_unknown":
      return CLI_EXIT_CODES.partialFailure;
    case "interrupted":
    case "mutation_interrupted_outcome_unknown":
      return CLI_EXIT_CODES.interrupted;
    case "service_not_found":
    case "service_operation_failed":
    case "service_operation_unsupported":
    case "schedule_invalid":
      return CLI_EXIT_CODES.operationalFailure;
  }
}
