import type { AdministrativeAuthenticationClock } from "../application/ports/administrative-authentication-clock.js";
import type { CloudflareAccessConfiguration } from "../domain/cloudflare-access-configuration.js";
import { CloudflareAccessAuthenticationProviderFactory } from "../application/cloudflare-access-authentication-provider-factory.js";
import type { CloudflareAccessAssertionReader } from "../application/ports/cloudflare-access-assertion-reader.js";
import { DenyAllAdministrativeAuthenticationProvider } from "../infrastructure/deny-all-administrative-authentication-provider.js";
import {
  CloudflareAccessJwksProvider,
  type CloudflareAccessJwksFetch,
} from "../infrastructure/cloudflare-access-jwks-provider.js";
import { CloudflareAccessJwtVerifierAdapter } from "../infrastructure/cloudflare-access-jwt-verifier.js";
import {
  emptyServiceTokenPrincipals,
  type CloudflareAccessServiceTokenPrincipals,
} from "../domain/cloudflare-access-service-token-principals.js";
import {
  createAdministrativeIdentityReadiness,
  type AdministrativeIdentityReadiness,
} from "../domain/administrative-identity-readiness.js";

export interface CloudflareAccessAdministrativeAuthenticationOverrides {
  readonly fetch?: CloudflareAccessJwksFetch;
}

export interface CloudflareAccessAdministrativeAuthenticationCapabilities {
  readonly createAuthenticationProviderForRequest: (
    reader: CloudflareAccessAssertionReader,
  ) => ReturnType<CloudflareAccessAuthenticationProviderFactory["create"]>;
  readonly checkIdentityProviderReadiness: () => Promise<
    "ready" | "unavailable"
  >;
  readonly readIdentityProviderReadiness: () => Promise<AdministrativeIdentityReadiness>;
}

export function createCloudflareAccessAdministrativeAuthentication(input: {
  readonly configuration?: CloudflareAccessConfiguration;
  readonly clock: AdministrativeAuthenticationClock;
  readonly overrides?: CloudflareAccessAdministrativeAuthenticationOverrides;
  /**
   * Declared Cloudflare Access service tokens (ADR-034). Omitted means no
   * service token can authenticate, which is the default posture.
   */
  readonly serviceTokenPrincipals?: CloudflareAccessServiceTokenPrincipals;
}): CloudflareAccessAdministrativeAuthenticationCapabilities {
  if (
    Reflect.ownKeys(input).some(
      (key) =>
        key !== "configuration" &&
        key !== "clock" &&
        key !== "overrides" &&
        key !== "serviceTokenPrincipals",
    )
  )
    throw new Error("Invalid Cloudflare Access authentication configuration");
  if (
    input.overrides !== undefined &&
    Reflect.ownKeys(input.overrides).some((key) => key !== "fetch")
  )
    throw new Error("Invalid Cloudflare Access authentication overrides");

  if (input.configuration === undefined) {
    const denyAll = new DenyAllAdministrativeAuthenticationProvider();
    const createAuthenticationProviderForRequest = () => denyAll;
    const checkIdentityProviderReadiness = () =>
      Promise.resolve<"unavailable">("unavailable");
    const readIdentityProviderReadiness = () =>
      Promise.resolve(
        createAdministrativeIdentityReadiness({
          outcome: "misconfigured",
          checkedAt: input.clock.now(),
          issuerConfigured: false,
          audienceConfigured: false,
          jwksReachable: false,
        }),
      );
    return Object.freeze({
      createAuthenticationProviderForRequest,
      checkIdentityProviderReadiness,
      readIdentityProviderReadiness,
    });
  }

  const jwksProvider = new CloudflareAccessJwksProvider(
    input.configuration,
    input.overrides?.fetch === undefined
      ? {}
      : { fetch: input.overrides.fetch },
  );
  const verifier = new CloudflareAccessJwtVerifierAdapter(
    input.configuration,
    jwksProvider,
    input.serviceTokenPrincipals ?? emptyServiceTokenPrincipals(),
  );
  const factory = new CloudflareAccessAuthenticationProviderFactory(
    verifier,
    input.clock,
  );
  const createAuthenticationProviderForRequest = (
    reader: CloudflareAccessAssertionReader,
  ) => factory.create(reader);
  const checkIdentityProviderReadiness = async () => {
    try {
      return await jwksProvider.checkReadiness(input.clock.now());
    } catch {
      return "unavailable" as const;
    }
  };
  const readIdentityProviderReadiness = async () => {
    const checkedAt = input.clock.now();
    const outcome = await jwksProvider.readReadiness(checkedAt);
    const snapshot = jwksProvider.readReadinessSnapshot();
    return createAdministrativeIdentityReadiness({
      outcome,
      checkedAt,
      issuerConfigured: true,
      audienceConfigured: true,
      jwksReachable: outcome === "ready",
      cachedKeyCount: snapshot.cachedKeyCount,
      cacheExpiresAt: snapshot.cacheExpiresAt,
      lastSuccessfulRefreshAt: snapshot.lastSuccessfulRefreshAt,
    });
  };
  return Object.freeze({
    createAuthenticationProviderForRequest,
    checkIdentityProviderReadiness,
    readIdentityProviderReadiness,
  });
}
