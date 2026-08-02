export const ADMINISTRATIVE_IDENTITY_READINESS_OUTCOMES = Object.freeze([
  "ready",
  "ready_with_cached_keys",
  "unavailable",
  "misconfigured",
] as const);

export type AdministrativeIdentityReadinessOutcome =
  (typeof ADMINISTRATIVE_IDENTITY_READINESS_OUTCOMES)[number];

export type AdministrativeIdentityReadiness = Readonly<{
  outcome: AdministrativeIdentityReadinessOutcome;
  checkedAt: string;
  issuerConfigured: boolean;
  audienceConfigured: boolean;
  jwksReachable: boolean;
  cachedKeyCount: number;
  cacheExpiresAt: string | null;
  lastSuccessfulRefreshAt: string | null;
}>;

export function createAdministrativeIdentityReadiness(input: {
  outcome: AdministrativeIdentityReadinessOutcome;
  checkedAt: Date;
  issuerConfigured: boolean;
  audienceConfigured: boolean;
  jwksReachable: boolean;
  cachedKeyCount?: number;
  cacheExpiresAt?: Date | null;
  lastSuccessfulRefreshAt?: Date | null;
}): AdministrativeIdentityReadiness {
  if (
    !Number.isInteger(input.cachedKeyCount ?? 0) ||
    (input.cachedKeyCount ?? 0) < 0
  )
    throw new Error("administrative_identity_readiness_invalid");
  const result = Object.freeze({
    outcome: input.outcome,
    checkedAt: input.checkedAt.toISOString(),
    issuerConfigured: input.issuerConfigured,
    audienceConfigured: input.audienceConfigured,
    jwksReachable: input.jwksReachable,
    cachedKeyCount: input.cachedKeyCount ?? 0,
    cacheExpiresAt: input.cacheExpiresAt?.toISOString() ?? null,
    lastSuccessfulRefreshAt:
      input.lastSuccessfulRefreshAt?.toISOString() ?? null,
  });
  return result;
}
