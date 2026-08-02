import { describe, expect, it } from "vitest";
import { runAdministrativeSecurityMaintenance } from "../../src/maintenance/administrative-security.js";

describe("administrative security maintenance", () => {
  it("verifies the built route catalog without network access", async () => {
    await expect(
      runAdministrativeSecurityMaintenance("verify-route-catalog"),
    ).resolves.toEqual({ result: "verified", routeCatalog: "reconciled" });
  });

  it("rejects general administration actions", async () => {
    await expect(runAdministrativeSecurityMaintenance("login")).rejects.toThrow(
      "action_invalid",
    );
  });
});
