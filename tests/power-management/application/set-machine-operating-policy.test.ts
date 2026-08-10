import { describe, expect, it } from "vitest";

import { SetMachineOperatingPolicy } from "../../../src/power-management/application/set-machine-operating-policy.js";
import { GetMachineOperatingPolicy } from "../../../src/power-management/application/get-machine-operating-policy.js";
import { InMemoryMachineOperatingPolicyStore } from "../../../src/power-management/infrastructure/in-memory-machine-operating-policy-store.js";
import { MachineOperatingPolicyValidationError } from "../../../src/power-management/domain/machine-operating-policy.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

describe("SetMachineOperatingPolicy", () => {
  it("validates and persists a policy through the domain factory", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    const useCase = new SetMachineOperatingPolicy(store);

    const result = await useCase.execute({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
      },
    });

    expect(result.mode).toBe("scheduled");
    await expect(store.find()).resolves.toEqual(result);
  });

  it("makes the persisted policy immediately visible through GetMachineOperatingPolicy", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    const setUseCase = new SetMachineOperatingPolicy(store);
    const getUseCase = new GetMachineOperatingPolicy(
      createMachineOperatingPolicy({ mode: "always_on" }),
      store,
    );

    await setUseCase.execute({ mode: "manual" });

    await expect(getUseCase.execute()).resolves.toEqual({
      policy: { mode: "manual" },
      source: "persisted",
    });
  });

  it("rejects an invalid policy without writing to the store", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    const useCase = new SetMachineOperatingPolicy(store);

    await expect(useCase.execute({ mode: "invalid" })).rejects.toBeInstanceOf(
      MachineOperatingPolicyValidationError,
    );
    await expect(store.find()).resolves.toBeNull();
  });

  it("replaces a previously persisted policy on a second save", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    const useCase = new SetMachineOperatingPolicy(store);

    await useCase.execute({ mode: "manual" });
    await useCase.execute({ mode: "always_on" });

    await expect(store.find()).resolves.toEqual({ mode: "always_on" });
  });
});
