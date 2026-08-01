export type LinuxPowerHelperTransportErrorCode =
  | "unsupported_platform"
  | "helper_not_found"
  | "helper_not_regular_file"
  | "helper_symbolic_link_rejected"
  | "helper_owner_invalid"
  | "helper_setuid_required"
  | "helper_group_invalid"
  | "helper_process_group_missing"
  | "helper_mode_invalid"
  | "helper_permissions_unsafe"
  | "helper_not_executable"
  | "helper_parent_invalid"
  | "helper_parent_owner_invalid"
  | "helper_inspection_failed"
  | "helper_start_failed"
  | "helper_io_failed"
  | "helper_exit_failed"
  | "helper_terminated"
  | "helper_timeout"
  | "helper_stdout_too_large"
  | "helper_stderr_too_large"
  | "helper_protocol_invalid";

export class LinuxPowerHelperTransportError extends Error {
  public override readonly name = "LinuxPowerHelperTransportError";

  public constructor(public readonly code: LinuxPowerHelperTransportErrorCode) {
    super(`Linux power-helper transport failed: ${code}`);
    Object.freeze(this);
  }
}

export type LinuxPowerHelperAdapterErrorCode =
  | "unsupported_platform"
  | "helper_unavailable"
  | "helper_installation_invalid"
  | "helper_timeout"
  | "helper_output_invalid"
  | "helper_operation_rejected"
  | "helper_operation_failed";

export class LinuxPowerHelperAdapterError extends Error {
  public override readonly name = "LinuxPowerHelperAdapterError";

  public constructor(public readonly code: LinuxPowerHelperAdapterErrorCode) {
    super(`Linux power-helper operation failed: ${code}`);
    Object.freeze(this);
  }
}
