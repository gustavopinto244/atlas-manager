/**
 * The closed set of units Atlas may ever observe (ADR-032 §2c).
 *
 * This is a union type and not a `string` on purpose: there is no reachable
 * "inspect any unit" capability anywhere in the system, and the type checker —
 * not a runtime allowlist that a later refactor could route around — is what
 * enforces it.
 */
export const DIAGNOSTIC_UNIT_NAMES = Object.freeze([
  "atlas-manager",
  "nginx",
  "cloudflared",
] as const);

export type DiagnosticUnitName = (typeof DIAGNOSTIC_UNIT_NAMES)[number];

export type SystemdUnitStateOutcome =
  | Readonly<{
      outcome: "observed";
      activeState: string;
      subState: string;
      unitFileState: string;
    }>
  | Readonly<{
      outcome: "undetermined";
      code:
        | "systemd_permission_denied"
        | "systemd_unavailable"
        | "systemd_timeout"
        | "systemd_output_invalid";
      requiresPrivilege: boolean;
    }>;

export interface SystemdUnitStateReader {
  read(unitName: DiagnosticUnitName): Promise<SystemdUnitStateOutcome>;
}
