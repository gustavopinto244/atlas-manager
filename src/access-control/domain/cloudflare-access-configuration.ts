const TEAM_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const PRINTABLE_ASCII_PATTERN = /^[\x21-\x7e]+$/u;

export type CloudflareAccessConfiguration = Readonly<{
  teamName: string;
  issuer: string;
  audience: string;
}>;

export class CloudflareAccessConfigurationError extends Error {
  public override readonly name = "CloudflareAccessConfigurationError";
  public constructor(
    public readonly code:
      | "cloudflare_access_configuration_invalid"
      | "invalid_team_name"
      | "invalid_audience",
  ) {
    super(`Invalid Cloudflare Access configuration: ${code}`);
    Object.freeze(this);
  }
}

export function createCloudflareAccessConfiguration(
  input: unknown,
): CloudflareAccessConfiguration {
  if (!isRecord(input) || Reflect.ownKeys(input).length !== 2)
    throw new CloudflareAccessConfigurationError(
      "cloudflare_access_configuration_invalid",
    );
  const teamName = input["teamName"];
  const audience = input["audience"];
  assertTeamName(teamName);
  assertAudience(audience);
  const issuer = `https://${teamName}.cloudflareaccess.com`;
  return Object.freeze({
    teamName,
    issuer,
    audience,
  });
}

export function assertTeamName(input: unknown): asserts input is string {
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > 63 ||
    input.trim() !== input ||
    !TEAM_NAME_PATTERN.test(input)
  )
    throw new CloudflareAccessConfigurationError("invalid_team_name");
}

export function assertAudience(input: unknown): asserts input is string {
  if (
    typeof input !== "string" ||
    input.length < 1 ||
    input.length > 256 ||
    input.trim() !== input ||
    !PRINTABLE_ASCII_PATTERN.test(input) ||
    input.includes(",") ||
    input.includes('"')
  )
    throw new CloudflareAccessConfigurationError("invalid_audience");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
