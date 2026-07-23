export type Pm2ServiceStatusReaderErrorCode =
  | "unsupported_status_adapter"
  | "pm2_status_command_failed"
  | "pm2_status_timeout"
  | "pm2_status_output_invalid"
  | "pm2_service_not_found"
  | "duplicate_pm2_service";

export class Pm2ServiceStatusReaderError extends Error {
  public override readonly name = "Pm2ServiceStatusReaderError";

  public constructor(public readonly code: Pm2ServiceStatusReaderErrorCode) {
    super(`PM2 service status error: ${code}`);
  }
}
