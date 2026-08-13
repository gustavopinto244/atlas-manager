import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ATLAS_COMMANDS } from "../../src/cli/command-tree.js";
import { ADMINISTRATIVE_ROUTE_SECURITY_CATALOG } from "../../src/http/administrative-route-security-catalog.js";

const ROOT = resolve(import.meta.dirname, "../..");

describe("current documentation inventories", () => {
  it("keeps capability route and CLI counts derived from source", () => {
    const capabilities = readFileSync(
      resolve(ROOT, "docs/capabilities.md"),
      "utf8",
    );
    const match = capabilities.match(
      /<!-- current-inventory (\{[^\n]+\}) -->/u,
    );
    expect(match).not.toBeNull();

    const inventory = JSON.parse(match![1]!) as {
      administrativeRouteDescriptors: number;
      cliCommandNodes: number;
      cliImplemented: number;
      cliStubs: number;
    };
    const implemented = ATLAS_COMMANDS.filter(
      (command) => command.implemented,
    ).length;

    expect(inventory).toEqual({
      administrativeRouteDescriptors:
        ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.length,
      cliCommandNodes: ATLAS_COMMANDS.length,
      cliImplemented: implemented,
      cliStubs: ATLAS_COMMANDS.length - implemented,
    });
  });

  it("keeps the versioned API contract on the same route inventory", () => {
    const contract = JSON.parse(
      readFileSync(
        resolve(ROOT, "docs/contracts/atlas-manager-administrative-api.json"),
        "utf8",
      ),
    ) as { routeCount: number; routeIds: readonly string[] };

    expect(contract.routeCount).toBe(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.length,
    );
    expect(contract.routeIds).toEqual(
      ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.map(({ routeId }) => routeId),
    );
  });
});
