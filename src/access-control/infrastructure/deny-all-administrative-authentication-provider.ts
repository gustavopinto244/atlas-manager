import type { AdministrativeAuthenticationProvider } from "../application/ports/administrative-authentication-provider.js";
import type { AdministrativeAuthenticationResult } from "../domain/administrative-authentication-result.js";

export class DenyAllAdministrativeAuthenticationProvider implements AdministrativeAuthenticationProvider {
  public authenticate(): Promise<AdministrativeAuthenticationResult> {
    return Promise.resolve(
      Object.freeze({
        outcome: "unauthenticated" as const,
        reason: "credentials_absent" as const,
      }),
    );
  }
}
