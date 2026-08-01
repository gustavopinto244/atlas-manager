import type { AdministrativeAuthenticationClock } from "./ports/administrative-authentication-clock.js";
import type { CloudflareAccessAssertionReader } from "./ports/cloudflare-access-assertion-reader.js";
import type { CloudflareAccessJwtVerifier } from "./ports/cloudflare-access-jwt-verifier.js";
import type { AdministrativeAuthenticationProvider } from "./ports/administrative-authentication-provider.js";
import { CloudflareAccessAdministrativeAuthenticationProvider } from "../infrastructure/cloudflare-access-authentication-provider.js";

export class CloudflareAccessAuthenticationProviderFactory {
  readonly #verifier: CloudflareAccessJwtVerifier;
  readonly #clock: AdministrativeAuthenticationClock;

  public constructor(
    verifier: CloudflareAccessJwtVerifier,
    clock: AdministrativeAuthenticationClock,
  ) {
    this.#verifier = verifier;
    this.#clock = clock;
    Object.freeze(this);
  }

  public create(
    reader: CloudflareAccessAssertionReader,
  ): AdministrativeAuthenticationProvider {
    return new CloudflareAccessAdministrativeAuthenticationProvider(
      reader,
      this.#verifier,
      this.#clock,
    );
  }
}
