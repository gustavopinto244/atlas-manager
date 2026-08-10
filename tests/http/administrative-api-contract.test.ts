import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ADMINISTRATIVE_ROUTE_SECURITY_CATALOG } from "../../src/http/administrative-route-security-catalog.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CONTRACT_PATH = resolve(
  __dirname,
  "../../docs/contracts/atlas-manager-administrative-api.json",
);

// The published contract's only real integrity mechanism is a whole-file
// SHA256 digest computed by scripts/generate-release-contract.mjs and
// scripts/generate-release-evidence.mjs, checked by
// scripts/validate-release-artifacts.mjs against a separate release
// artifact -- there is no generator or verifier anywhere in this repository
// for an internal per-field digest (confirmed by grep across scripts/,
// deployment/ and tests/). This test is the actual reconciliation the
// contract needs: it fails whenever a route is added, removed or renamed in
// source without updating the published snapshot.
describe("administrative API contract reconciliation", () => {
  const contract = JSON.parse(readFileSync(CONTRACT_PATH, "utf8")) as {
    schemaVersion: number;
    routeCatalog: string;
    routeCount: number;
    routeIds: readonly string[];
  };

  it("does not carry an unverified internal digest field", () => {
    expect(Object.hasOwn(contract, "catalogSha256")).toBe(false);
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
