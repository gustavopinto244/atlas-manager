import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { createAdministrativeApiContract } from "../../src/http/administrative-api-contract.js";
import { ADMINISTRATIVE_ROUTE_SECURITY_CATALOG } from "../../src/http/administrative-route-security-catalog.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CONTRACT_PATH = resolve(
  __dirname,
  "../../docs/contracts/atlas-manager-administrative-api.json",
);

// catalogSha256 is not an arbitrary/orphaned field: CI's release gate
// (.github/workflows/ci.yml, "Release candidate security and contract gate")
// imports createAdministrativeApiContract() directly and rejects the build
// if its computed digest does not match this file's catalogSha256. This
// test is the local equivalent of that gate, plus the route
// count/order/closed-catalog reconciliation.
describe("administrative API contract reconciliation", () => {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as {
    schemaVersion: number;
    routeCatalog: string;
    routeCount: number;
    routeIds: readonly string[];
    catalogSha256: string;
  };

  it("carries a digest matching the authoritative contract serialization", () => {
    expect(contract.catalogSha256).toBe(
      createAdministrativeApiContract().sha256,
    );
  });

  it("declares a route count matching the live catalog", () => {
    expect(contract.routeCount).toBe(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.length,
    );
  });

  it("lists exactly the live catalog's route IDs, in the same order", () => {
    expect(contract.routeIds).toEqual(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.map(
        (descriptor) => descriptor.routeId,
      ),
    );
  });

  it("declares the catalog as closed", () => {
    expect(contract.routeCatalog).toBe("closed");
  });
});
