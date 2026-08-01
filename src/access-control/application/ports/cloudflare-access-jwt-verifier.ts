import type { AdministrativeAuthenticationResult } from "../../domain/administrative-authentication-result.js";
import type { CloudflareAccessJwtAssertion } from "../../domain/cloudflare-access-jwt-assertion.js";

export interface CloudflareAccessJwtVerifier {
  verify(
    assertion: CloudflareAccessJwtAssertion,
    verificationTime: Date,
  ): Promise<AdministrativeAuthenticationResult>;
}
