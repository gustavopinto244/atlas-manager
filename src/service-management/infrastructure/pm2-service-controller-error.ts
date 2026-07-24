export type Pm2ServiceControllerErrorCode =
  | "unsupported_control_adapter"
  | "pm2_control_operation_invalid"
  | "pm2_control_process_list_invalid"
  | "pm2_control_target_not_found"
  | "duplicate_pm2_control_target"
  | "pm2_control_target_invalid"
  | "pm2_control_command_failed"
  | "pm2_control_timeout";

export class Pm2ServiceControllerError extends Error {
  public override readonly name = "Pm2ServiceControllerError";

  public constructor(public readonly code: Pm2ServiceControllerErrorCode) {
    super(`PM2 service control error: ${code}`);
  }
}
