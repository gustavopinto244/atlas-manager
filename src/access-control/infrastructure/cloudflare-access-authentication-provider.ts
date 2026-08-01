import type { AdministrativeAuthenticationProvider } from "../application/ports/administrative-authentication-provider.js";
import type { AdministrativeAuthenticationClock } from "../application/ports/administrative-authentication-clock.js";
import type { CloudflareAccessAssertionReader } from "../application/ports/cloudflare-access-assertion-reader.js";
import type { CloudflareAccessJwtVerifier } from "../application/ports/cloudflare-access-jwt-verifier.js";
import type { AdministrativeAuthenticationResult } from "../domain/administrative-authentication-result.js";

export class CloudflareAccessAdministrativeAuthenticationProvider implements AdministrativeAuthenticationProvider {
  readonly #reader: CloudflareAccessAssertionReader;
  readonly #verifier: CloudflareAccessJwtVerifier;
  readonly #clock: AdministrativeAuthenticationClock;

  public constructor(
    reader: CloudflareAccessAssertionReader,
    verifier: CloudflareAccessJwtVerifier,
    clock: AdministrativeAuthenticationClock,
  ) {
    this.#reader = reader;
    this.#verifier = verifier;
    this.#clock = clock;
    Object.freeze(this);
  }

  public async authenticate(): Promise<AdministrativeAuthenticationResult> {
    try {
      const assertion = this.#reader.read();
      if (assertion.outcome === "absent")
        return Object.freeze({
          outcome: "unauthenticated" as const,
          reason: "credentials_absent" as const,
        });
      if (assertion.outcome === "invalid")
        return Object.freeze({
          outcome: "unauthenticated" as const,
          reason: "credentials_invalid" as const,
        });
      return await this.#verifier.verify(
        assertion.assertion,
        this.#clock.now(),
      );
    } catch {
      return Object.freeze({
        outcome: "unavailable" as const,
        reason: "identity_provider_unavailable" as const,
      });
    }
  }
}
