/**
 * CLI-side binding to the canonical administrative route security catalog
 * (`src/http/administrative-route-security-catalog.ts`).
 *
 * The CLI cannot import that catalog at runtime: the operator package ships
 * only `dist/cli`, so a server import would either break the package or drag
 * the whole application composition into it. ADR-031 therefore declares this
 * small table as the CLI's copy of the contract and pins it to the catalog
 * with a contract test — `tests/cli/administrative-contract.test.ts` fails if
 * a route id, method, path template or confirmation ever drifts apart.
 *
 * Nothing here may be hand-edited to "fix" a failing contract test. The
 * catalog is authoritative; this table follows it.
 */

export type AtlasServiceOperation = "start" | "stop" | "restart";

export const ATLAS_SERVICE_OPERATIONS: readonly AtlasServiceOperation[] =
  Object.freeze(["start", "stop", "restart"]);

export type AtlasAdministrativeMutationDescriptor = Readonly<{
  /** Route id in the administrative route security catalog. */
  routeId: string;
  method: "POST" | "PUT" | "DELETE";
  /** Path template exactly as the catalog declares it. */
  pathTemplate: string;
  /**
   * The exact confirmation the route's `confirmationPolicy` requires. Derived
   * from the catalog, never invented by a command handler.
   */
  confirmation: string;
}>;

const SERVICE_ACTION_MUTATIONS: Readonly<
  Record<AtlasServiceOperation, AtlasAdministrativeMutationDescriptor>
> = Object.freeze({
  start: Object.freeze({
    routeId: "services.start",
    method: "POST",
    pathTemplate: "/admin/services/:serviceId/actions/start",
    confirmation: "confirm_registered_service_start",
  }),
  stop: Object.freeze({
    routeId: "services.stop",
    method: "POST",
    pathTemplate: "/admin/services/:serviceId/actions/stop",
    confirmation: "confirm_registered_service_stop",
  }),
  restart: Object.freeze({
    routeId: "services.restart",
    method: "POST",
    pathTemplate: "/admin/services/:serviceId/actions/restart",
    confirmation: "confirm_registered_service_restart",
  }),
});

export const ATLAS_SERVICE_ACTION_MUTATIONS = SERVICE_ACTION_MUTATIONS;

/** Path template of the authoritative single-service read used after a mutation. */
export const ATLAS_SERVICE_READ_PATH_TEMPLATE = "/admin/services/:serviceId";

export function serviceActionMutation(
  operation: AtlasServiceOperation,
): AtlasAdministrativeMutationDescriptor {
  return SERVICE_ACTION_MUTATIONS[operation];
}

export function serviceActionPath(
  operation: AtlasServiceOperation,
  serviceId: string,
): string {
  return SERVICE_ACTION_MUTATIONS[operation].pathTemplate.replace(
    ":serviceId",
    encodeURIComponent(serviceId),
  );
}

export function serviceReadPath(serviceId: string): string {
  return ATLAS_SERVICE_READ_PATH_TEMPLATE.replace(
    ":serviceId",
    encodeURIComponent(serviceId),
  );
}

/**
 * Registered-service identifier grammar, mirroring the server's `isServiceId`.
 * Applied in the CLI only to reject obvious usage errors before spending a
 * request; the server remains authoritative and rejects anything this misses.
 */
const SERVICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isAtlasServiceId(value: string): boolean {
  return (
    value.length > 0 && value.length <= 64 && SERVICE_ID_PATTERN.test(value)
  );
}
