import { describe, expect, it } from "vitest";

import {
  ATLAS_SERVICE_ACTION_MUTATIONS,
  ATLAS_SERVICE_OPERATIONS,
  ATLAS_SERVICE_READ_PATH_TEMPLATE,
  serviceActionPath,
  serviceReadPath,
} from "../../src/cli/administrative-contract.js";
import { ADMINISTRATIVE_ROUTE_SECURITY_CATALOG } from "../../src/http/administrative-route-security-catalog.js";

function descriptorFor(routeId: string) {
  const descriptor = ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.find(
    (entry) => entry.routeId === routeId,
  );
  if (descriptor === undefined)
    throw new Error(`route descriptor missing: ${routeId}`);
  return descriptor;
}

describe("CLI administrative contract binding", () => {
  // The operator package ships only dist/cli, so the CLI cannot import the
  // server catalog at runtime. This test is what keeps its copy honest: if a
  // route id, method, path template or confirmation ever changes server-side,
  // the CLI's declaration fails here rather than in production.
  it("matches the canonical route security catalog for every service mutation", () => {
    for (const operation of ATLAS_SERVICE_OPERATIONS) {
      const declared = ATLAS_SERVICE_ACTION_MUTATIONS[operation];
      const canonical = descriptorFor(declared.routeId);
      expect(declared.routeId, operation).toBe(`services.${operation}`);
      expect(declared.method, operation).toBe(canonical.method);
      expect(declared.pathTemplate, operation).toBe(canonical.pathTemplate);
      expect(canonical.confirmationPolicy, operation).toBe(
        `exact:${declared.confirmation}`,
      );
    }
  });

  it("declares no confirmation the catalog does not require", () => {
    const catalogConfirmations = new Set(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.filter(
        (entry) => entry.confirmationPolicy !== "none",
      ).map((entry) => entry.confirmationPolicy),
    );
    for (const operation of ATLAS_SERVICE_OPERATIONS)
      expect(
        catalogConfirmations.has(
          `exact:${ATLAS_SERVICE_ACTION_MUTATIONS[operation].confirmation}`,
        ),
        operation,
      ).toBe(true);
  });

  it("binds the authoritative re-read to the catalog's single-service route", () => {
    expect(ATLAS_SERVICE_READ_PATH_TEMPLATE).toBe(
      descriptorFor("services.read").pathTemplate,
    );
  });

  it("keeps every service mutation behind authentication, RBAC and a mutation gate", () => {
    for (const operation of ATLAS_SERVICE_OPERATIONS) {
      const canonical = descriptorFor(`services.${operation}`);
      expect(canonical.authenticationPolicy, operation).toBe("required");
      expect(canonical.permission, operation).toBe(`services.${operation}`);
      expect(canonical.gatePolicy, operation).toBe("service_mutation");
      expect(canonical.auditPolicy, operation).toBe(
        "authorization_started_terminal",
      );
      expect(canonical.replayPolicy, operation).toBe("state_recheck_required");
    }
  });

  it("builds request paths by encoding the service id into the template", () => {
    expect(serviceActionPath("restart", "task-manager")).toBe(
      "/admin/services/task-manager/actions/restart",
    );
    expect(serviceReadPath("task-manager")).toBe(
      "/admin/services/task-manager",
    );
  });
});
