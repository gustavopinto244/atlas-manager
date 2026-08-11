import { describe, expect, it } from "vitest";

import { RemoveMachineOperatingPolicy } from "../../../src/power-management/application/remove-machine-operating-policy.js";
import { GetMachineOperatingPolicy } from "../../../src/power-management/application/get-machine-operating-policy.js";
import { InMemoryMachineOperatingPolicyStore } from "../../../src/power-management/infrastructure/in-memory-machine-operating-policy-store.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

describe("RemoveMachineOperatingPolicy", () => {
  it("deletes a persisted policy", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    await store.save(createMachineOperatingPolicy({ mode: "manual" }));
    const useCase = new RemoveMachineOperatingPolicy(store);

    await useCase.execute();

    await expect(store.find()).resolves.toBeNull();
  });

  it("is idempotent when nothing was persisted", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    const useCase = new RemoveMachineOperatingPolicy(store);

    await expect(useCase.execute()).resolves.toBeUndefined();
    await expect(store.find()).resolves.toBeNull();
  });

  it("reverts the effective policy to the environment default (rollback path)", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    await store.save(createMachineOperatingPolicy({ mode: "manual" }));
    const getUseCase = new GetMachineOperatingPolicy(
      createMachineOperatingPolicy({ mode: "always_on" }),
      store,
    );
    const removeUseCase = new RemoveMachineOperatingPolicy(store);
    await expect(getUseCase.execute()).resolves.toMatchObject({
      source: "persisted",
    });

    await removeUseCase.execute();

    await expect(getUseCase.execute()).resolves.toEqual({
      policy: { mode: "always_on" },
      source: "environment_default",
    });
  });
});
