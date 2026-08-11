import { describe, expect, it } from "vitest";
import {
  administrativePrincipalActorId,
  createAdministrativePrincipal,
  isCanonicalAdministrativePrincipalId,
} from "../../src/access-control/domain/administrative-principal.js";

const PRINCIPAL_ID = "caf45cc3-4312-5d41-8603-cc0102346a1f";

describe("administrative principal identifiers", () => {
  it.each([
    "00000000-0000-4000-8000-000000000001",
    "caf45cc3-4312-5d41-8603-cc0102346a1f",
  ])("accepts RFC 4122 UUID %s", (principalId) => {
    expect(isCanonicalAdministrativePrincipalId(principalId)).toBe(true);
    expect(createAdministrativePrincipal({ principalId })).toEqual({
      principalId,
      kind: "human",
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

describe("administrative principal kind (ADR-034)", () => {
  it("defaults to a human principal when no kind is supplied", () => {
    expect(
      createAdministrativePrincipal({ principalId: PRINCIPAL_ID }).kind,
    ).toBe("human");
  });

  it("accepts an explicit human or service kind", () => {
    for (const kind of ["human", "service"] as const) {
      expect(
        createAdministrativePrincipal({ principalId: PRINCIPAL_ID, kind }),
      ).toEqual({ principalId: PRINCIPAL_ID, kind });
    }
  });

  it.each(["administrator", "machine", "", null, 1])(
    "rejects unknown kind %s",
    (kind) => {
      expect(() =>
        createAdministrativePrincipal({ principalId: PRINCIPAL_ID, kind }),
      ).toThrow("invalid_principal");
    },
  );

  it("rejects unknown extra keys alongside a valid principal", () => {
    expect(() =>
      createAdministrativePrincipal({
        principalId: PRINCIPAL_ID,
        role: "administrator",
      }),
    ).toThrow("invalid_principal");
  });

  // The prefix is the only thing separating a person from a machine in the
  // audit trail, so it must be derived from the kind and never coincide.
  it("derives a distinct audit actor id per kind", () => {
    expect(
      administrativePrincipalActorId(
        createAdministrativePrincipal({ principalId: PRINCIPAL_ID }),
      ),
    ).toBe(`administrator:${PRINCIPAL_ID}`);
    expect(
      administrativePrincipalActorId(
        createAdministrativePrincipal({
          principalId: PRINCIPAL_ID,
          kind: "service",
        }),
      ),
    ).toBe(`service:${PRINCIPAL_ID}`);
  });
});
