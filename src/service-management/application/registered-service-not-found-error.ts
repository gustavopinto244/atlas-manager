export class RegisteredServiceNotFoundError extends Error {
  public override readonly name: string = "RegisteredServiceNotFoundError";
  public readonly code = "registered_service_not_found";

  public constructor() {
    super("Registered service not found");
  }
}
