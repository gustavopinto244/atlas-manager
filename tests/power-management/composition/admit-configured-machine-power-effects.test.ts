import { describe, expect, it, vi } from "vitest";

import { parseEnvironment } from "../../../src/config/environment.js";
import {
  admitConfiguredMachinePowerEffects,
  MachinePowerEffectsAdmissionError,
} from "../../../src/power-management/composition/admit-configured-machine-power-effects.js";
import { LinuxPowerHelperInstallationPreflightError } from "../../../src/power-management/infrastructure/linux-power-helper-installation-preflight.js";

const DIGEST = "a".repeat(64);

describe("configured machine power-effects admission", () => {
  it("keeps mock and inert Linux selection disabled without preflight", () => {
    const preflight = { inspect: vi.fn() };
    expect(
      admitConfiguredMachinePowerEffects(parseEnvironment({}), { preflight }),
    ).toEqual({ kind: "disabled" });
    expect(
      admitConfiguredMachinePowerEffects(
        parseEnvironment({ POWER_MANAGEMENT_BACKEND: "linux_helper" }),
        { preflight },
      ),
    ).toEqual({ kind: "disabled" });
    expect(preflight.inspect).not.toHaveBeenCalled();
  });

  it("runs exactly one preflight for admitted Linux effects", () => {
    const preflight = { inspect: vi.fn() };
    const config = parseEnvironment({
      POWER_MANAGEMENT_BACKEND: "linux_helper",
      MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
      MACHINE_POWER_EFFECTS_CONFIRMATION: "confirm_linux_helper_power_effects",
      LINUX_POWER_HELPER_EXPECTED_SHA256: DIGEST,
      MACHINE_POWER_SCHEDULER_ENABLED: "true",
      MACHINE_POWER_SCHEDULER_CURSOR_FILE:
        "/var/lib/atlas-manager/power-cursor.json",
      MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
        "/var/lib/atlas-manager/power-claims.json",
      ADMINISTRATIVE_EVENT_HISTORY_FILE: "/var/lib/atlas-manager/events.jsonl",
    });

    const admission = admitConfiguredMachinePowerEffects(config, { preflight });

    expect(admission).toEqual({ kind: "linux_helper" });
    expect(Object.isFrozen(admission)).toBe(true);
    expect(preflight.inspect).toHaveBeenCalledExactlyOnceWith(DIGEST);
  });

  it("maps preflight failures without fallback", () => {
    const preflight = {
      inspect: vi.fn(() => {
        throw new LinuxPowerHelperInstallationPreflightError(
          "helper_hash_mismatch",
        );
      }),
    };
    const config = parseEnvironment({
      POWER_MANAGEMENT_BACKEND: "linux_helper",
      ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED: "true",
      HOST: "127.0.0.1",
      CLOUDFLARE_ACCESS_TEAM_NAME: "atlas",
      CLOUDFLARE_ACCESS_AUDIENCE: "aud",
      ADMINISTRATIVE_EVENT_HISTORY_FILE: "/var/lib/atlas-manager/events.jsonl",
      ADMINISTRATIVE_ROLE_ASSIGNMENTS: JSON.stringify([
        {
          principalId: "00000000-0000-4000-8000-000000000001",
          roles: ["power_operator"],
        },
      ]),
      MACHINE_POWER_EFFECTS_ACTIVATION: "linux_helper",
      MACHINE_POWER_EFFECTS_CONFIRMATION: "confirm_linux_helper_power_effects",
      LINUX_POWER_HELPER_EXPECTED_SHA256: DIGEST,
      MACHINE_SHUTDOWN_OCCURRENCE_CLAIM_FILE:
        "/var/lib/atlas-manager/shutdown-claims.json",
      MACHINE_POWER_SCHEDULER_CURSOR_FILE:
        "/var/lib/atlas-manager/shutdown-cursor.json",
    });

    expect(() =>
      admitConfiguredMachinePowerEffects(config, { preflight }),
    ).toThrow(new MachinePowerEffectsAdmissionError("helper_hash_mismatch"));
  });
});
