export type AdministrativeAccessControlErrorCode =
  | "administrative_authentication_required"
  | "administrative_identity_unavailable"
  | "administrative_authorization_denied"
  | "administrative_authorization_unavailable"
  | "authorization_audit_unavailable"
  | "protected_operation_failed";

export class AdministrativeAccessControlError extends Error {
  public override readonly name = "AdministrativeAccessControlError";
  public constructor(
    public readonly code: AdministrativeAccessControlErrorCode,
    public readonly operation?: string,
  ) {
    super(code);
    Object.freeze(this);
  }
}
