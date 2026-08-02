import { createHash } from "node:crypto";
import {
  ADMINISTRATIVE_ROUTE_SECURITY_CATALOG,
  type AdministrativeRouteSecurityDescriptor,
} from "./administrative-route-security-catalog.js";

export function createAdministrativeApiContract(
  catalog: readonly AdministrativeRouteSecurityDescriptor[] = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG,
): Readonly<{ schemaVersion: 1; routes: readonly unknown[]; sha256: string }> {
  const routes = catalog.map((route) =>
    Object.freeze({
      routeId: route.routeId,
      method: route.method,
      pathTemplate: route.pathTemplate,
      activationFlag: route.activationFlag,
      operation: route.operation,
      permission: route.permission,
      request: route.requestPolicy,
      confirmation: route.confirmationPolicy,
      gate: route.gatePolicy,
      audit: route.auditPolicy,
      replay: route.replayPolicy,
      response: route.responsePolicy,
    }),
  );
  const value = Object.freeze({
    schemaVersion: 1 as const,
    routes: Object.freeze(routes),
  });
  const bytes = Buffer.from(JSON.stringify(value) + "\n", "utf8");
  return Object.freeze({
    ...value,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}
