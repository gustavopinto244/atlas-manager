import type { AdministrativeAuthenticationResult } from "../../domain/administrative-authentication-result.js";

export interface AdministrativeAuthenticationProvider {
  authenticate(): Promise<AdministrativeAuthenticationResult>;
}
