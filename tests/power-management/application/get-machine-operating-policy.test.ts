import { describe, expect, it } from "vitest";

import { GetMachineOperatingPolicy } from "../../../src/power-management/application/get-machine-operating-policy.js";
import { InMemoryMachineOperatingPolicyStore } from "../../../src/power-management/infrastructure/in-memory-machine-operating-policy-store.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

describe("GetMachineOperatingPolicy", () => {
  it("resolves the environment default when no store is configured", async () => {
    const useCase = new GetMachineOperatingPolicy(
      createMachineOperatingPolicy({ mode: "always_on" }),
    );

    await expect(useCase.execute()).resolves.toEqual({
      policy: { mode: "always_on" },
      source: "environment_default",
    });
  });

  it("resolves the environment default when the store holds nothing", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    const useCase = new GetMachineOperatingPolicy(
      createMachineOperatingPolicy({ mode: "manual" }),
      store,
    );

    await expect(useCase.execute()).resolves.toEqual({
      policy: { mode: "manual" },
      source: "environment_default",
    });
  });

  it("prefers the persisted policy over the environment default", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    await store.save(createMachineOperatingPolicy({ mode: "manual" }));
    const useCase = new GetMachineOperatingPolicy(
      createMachineOperatingPolicy({ mode: "always_on" }),
      store,
    );

    await expect(useCase.execute()).resolves.toEqual({
      policy: { mode: "manual" },
      source: "persisted",
    });
  });

  it("reflects removal back to the environment default", async () => {
    const store = new InMemoryMachineOperatingPolicyStore();
    await store.save(createMachineOperatingPolicy({ mode: "manual" }));
    const useCase = new GetMachineOperatingPolicy(
      createMachineOperatingPolicy({ mode: "always_on" }),
      store,
    );
    await expect(useCase.execute()).resolves.toMatchObject({
      source: "persisted",
    });

    await store.remove();

    await expect(useCase.execute()).resolves.toEqual({
      policy: { mode: "always_on" },
      source: "environment_default",
    });
  });
});
