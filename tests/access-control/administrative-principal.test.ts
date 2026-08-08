import { describe, expect, it } from "vitest";
import {
  createAdministrativePrincipal,
  isCanonicalAdministrativePrincipalId,
} from "../../src/access-control/domain/administrative-principal.js";

describe("administrative principal identifiers", () => {
  it.each([
    "00000000-0000-4000-8000-000000000001",
    "caf45cc3-4312-5d41-8603-cc0102346a1f",
  ])("accepts RFC 4122 UUID %s", (principalId) => {
    expect(isCanonicalAdministrativePrincipalId(principalId)).toBe(true);
    expect(createAdministrativePrincipal({ principalId })).toEqual({
      principalId,
    });
  });

  it.each([
    "00000000-0000-4000-c000-000000000001",
    "00000000-0000-6000-8000-000000000001",
    "CAF45CC3-4312-5D41-8603-CC0102346A1F",
    "caf45cc3-4312-5d41-8603-cc0102346a1",
    "caf45cc3-4312-5d41-8603-cc0102346a1f ",
    "not-a-uuid",
    "",
  ])("rejects non-canonical principal %s", (principalId) => {
    expect(isCanonicalAdministrativePrincipalId(principalId)).toBe(false);
    expect(() => createAdministrativePrincipal({ principalId })).toThrow(
      "invalid_principal",
    );
  });
});
