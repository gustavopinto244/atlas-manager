import {
  createAdministrativeAuthenticationResult,
  type AdministrativeAuthenticationResult,
} from "../domain/administrative-authentication-result.js";
import type { AdministrativeAuthenticationProvider } from "./ports/administrative-authentication-provider.js";

export class AuthenticateAdministrativeRequest {
  readonly #provider: AdministrativeAuthenticationProvider;
  public constructor(provider: AdministrativeAuthenticationProvider) {
    this.#provider = provider;
    Object.freeze(this);
  }

  public async execute(): Promise<AdministrativeAuthenticationResult> {
    try {
      return createAdministrativeAuthenticationResult(
        await this.#provider.authenticate(),
      );
    } catch {
      return Object.freeze({
        outcome: "unavailable" as const,
        reason: "identity_provider_unavailable" as const,
      });
    }
  }
}
