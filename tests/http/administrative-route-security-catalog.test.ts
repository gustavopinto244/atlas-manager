import { describe, expect, it } from "vitest";
import { createAdministrativeApiContract } from "../../src/http/administrative-api-contract.js";
import {
  ADMINISTRATIVE_ROUTE_SECURITY_CATALOG,
  validateAdministrativeRouteSecurityCatalog,
} from "../../src/http/administrative-route-security-catalog.js";

describe("administrative route security catalog", () => {
  it("is closed, unique, authenticated, and deterministically mapped", () => {
    expect(() => validateAdministrativeRouteSecurityCatalog()).not.toThrow();
    expect(ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.length).toBe(41);
    expect(
      new Set(
        ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.map((route) => route.routeId),
      ).size,
    ).toBe(41);
    expect(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.every(
        (route) => route.authenticationPolicy === "required",
      ),
    ).toBe(true);
    expect(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.every(
        (route) => route.permission.length > 0,
      ),
    ).toBe(true);
  });

  it("produces a stable contract digest", () => {
    const first = createAdministrativeApiContract();
    const second = createAdministrativeApiContract();
    expect(first).toEqual(second);
    expect(first.sha256).toBe(
      "3971df6e1a67ebbba21298a7191ae71d1936faf78374e0d7dbbabc4826ce2574",
    );
  });
});
