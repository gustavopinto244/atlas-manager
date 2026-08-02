import { parseEnvironment } from "../config/environment.js";
import { validateAdministrativeRouteSecurityCatalog } from "../http/administrative-route-security-catalog.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../access-control/composition/create-cloudflare-access-administrative-authentication.js";

const ACTIONS = new Set([
  "inspect",
  "verify-configuration",
  "verify-route-catalog",
  "verify-identity",
]);

export async function runAdministrativeSecurityMaintenance(
  action: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Readonly<Record<string, unknown>>> {
  if (!ACTIONS.has(action)) throw new Error("action_invalid");
  if (action === "verify-route-catalog") {
    validateAdministrativeRouteSecurityCatalog();
    return Object.freeze({ result: "verified", routeCatalog: "reconciled" });
  }
  const config = parseEnvironment(environment);
  if (action === "inspect")
    return Object.freeze({
      result: "inspected",
      loopbackBinding: config.host === "127.0.0.1",
      publicOriginConfigured: config.administrativePublicOrigin !== undefined,
      cloudflareConfigured: config.cloudflareAccess !== undefined,
      sessionPosture: "stateless",
    });
  if (action === "verify-configuration")
    return Object.freeze({
      result: "verified",
      loopbackBinding: config.host === "127.0.0.1",
    });
  // Identity verification is intentionally explicit and not part of startup.
  if (config.cloudflareAccess === undefined)
    return Object.freeze({ result: "misconfigured", networkRequest: false });
  const authentication = createCloudflareAccessAdministrativeAuthentication({
    configuration: config.cloudflareAccess,
    clock: Object.freeze({ now: () => new Date() }),
  });
  const readiness = await authentication.readIdentityProviderReadiness();
  return Object.freeze({
    result: readiness.outcome,
    networkRequest: true,
  });
}

if (process.argv[1]?.endsWith("administrative-security.js")) {
  const action = process.argv[2];
  if (process.argv.length !== 3 || action === undefined) process.exitCode = 2;
  else
    void runAdministrativeSecurityMaintenance(action)
      .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
      .catch(() => {
        process.stderr.write("administrative_security_maintenance_failed\n");
        process.exitCode = 1;
      });
}
