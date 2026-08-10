import { createRequire } from "node:module";

/**
 * The single runtime source of the application version.
 *
 * It was previously duplicated as a literal in two composition sites, which
 * drifted: the administrative overview reported 1.0.0-rc.8 on a 1.0.0-rc.11
 * build. Deriving it from package.json means a release bump cannot leave a
 * stale version behind.
 *
 * package.json ships beside dist/ in the deployment bundle, so this resolves
 * both from a source checkout and from an installed release.
 */

const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export class ApplicationVersionError extends Error {
  public override readonly name = "ApplicationVersionError";

  public constructor() {
    super("application_package_version_invalid");
  }
}

export function readApplicationVersion(value: unknown): string {
  if (typeof value !== "string" || !VERSION_PATTERN.test(value))
    throw new ApplicationVersionError();
  return value;
}

function resolveApplicationVersion(): string {
  const metadata = createRequire(import.meta.url)("../../package.json") as
    Readonly<{ version?: unknown }> | undefined;
  return readApplicationVersion(metadata?.version);
}

export const APPLICATION_VERSION: string = resolveApplicationVersion();
