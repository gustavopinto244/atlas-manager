import {
  createAdministrativeAuthenticationResult,
  type AdministrativeAuthenticationResult,
} from "../domain/administrative-authentication-result.js";
import type { AdministrativeAuthenticationProvider } from "../application/ports/administrative-authentication-provider.js";

export interface MockAdministrativeAuthenticationProviderConfiguration {
  readonly result?: unknown;
  readonly failure?: Error;
}

export class MockAdministrativeAuthenticationProvider implements AdministrativeAuthenticationProvider {
  readonly #result: AdministrativeAuthenticationResult;
  readonly #failure: Error | undefined;
  #invocationCount = 0;

  public constructor(
    configuration: MockAdministrativeAuthenticationProviderConfiguration = {},
  ) {
    if (
      Reflect.ownKeys(configuration).some(
        (key) => key !== "result" && key !== "failure",
      )
    )
      throw new Error("Invalid mock authentication configuration");
    this.#result = createAdministrativeAuthenticationResult(
      configuration.result ?? {
        outcome: "unauthenticated",
        reason: "credentials_absent",
      },
    );
    this.#failure = configuration.failure;
    Object.freeze(this);
  }

  public authenticate(): Promise<AdministrativeAuthenticationResult> {
    this.#invocationCount += 1;
    if (this.#failure) return Promise.reject(this.#failure);
    return Promise.resolve(this.#result);
  }

  public get invocationCount(): number {
    return this.#invocationCount;
  }
}
