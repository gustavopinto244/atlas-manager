import {
  createAdministrativePrincipal,
  type AdministrativePrincipal,
} from "../domain/administrative-principal.js";
import {
  createAdministrativeRoleCollection,
  type AdministrativeRole,
} from "../domain/administrative-role.js";
import type {
  AdministrativeRoleAssignmentReader,
  AdministrativeRoleAssignmentResult,
} from "../application/ports/administrative-role-assignment-reader.js";

export interface InMemoryAdministrativeRoleAssignment {
  readonly principalId: unknown;
  readonly roles: unknown;
}

export interface InMemoryAdministrativeRoleAssignmentReaderConfiguration {
  readonly assignments?: readonly InMemoryAdministrativeRoleAssignment[];
  readonly failure?: Error;
}

export class InMemoryAdministrativeRoleAssignmentReader implements AdministrativeRoleAssignmentReader {
  readonly #assignments: ReadonlyMap<string, readonly AdministrativeRole[]>;
  readonly #failure: Error | undefined;
  readonly #lookups: string[] = [];

  public constructor(
    configuration: InMemoryAdministrativeRoleAssignmentReaderConfiguration = {},
  ) {
    if (
      Reflect.ownKeys(configuration).some(
        (key) => key !== "assignments" && key !== "failure",
      )
    )
      throw new Error("Invalid role assignment configuration");
    const assignments = configuration.assignments ?? [];
    const map = new Map<string, readonly AdministrativeRole[]>();
    for (const assignment of assignments) {
      if (!isAssignmentRecord(assignment))
        throw new Error("Invalid role assignment configuration");
      const principal = createAdministrativePrincipal({
        principalId: assignment.principalId,
      });
      if (map.has(principal.principalId))
        throw new Error("Duplicate principal assignment");
      map.set(
        principal.principalId,
        createAdministrativeRoleCollection(assignment.roles),
      );
    }
    this.#assignments = map;
    this.#failure = configuration.failure;
    Object.freeze(this);
  }

  public read(
    principal: AdministrativePrincipal,
  ): Promise<AdministrativeRoleAssignmentResult> {
    const validated = createAdministrativePrincipal(principal);
    this.#lookups.push(validated.principalId);
    if (this.#failure) return Promise.reject(this.#failure);
    const roles = this.#assignments.get(validated.principalId);
    return Promise.resolve(
      roles
        ? Object.freeze({ outcome: "assigned" as const, roles })
        : Object.freeze({ outcome: "unknown_principal" as const }),
    );
  }

  public get lookupPrincipalIds(): readonly string[] {
    return Object.freeze([...this.#lookups]);
  }
}

function isAssignmentRecord(
  input: unknown,
): input is InMemoryAdministrativeRoleAssignment {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return false;
  const record = input as Record<string, unknown>;
  const keys = Reflect.ownKeys(record);
  return (
    keys.length === 2 && keys.includes("principalId") && keys.includes("roles")
  );
}
