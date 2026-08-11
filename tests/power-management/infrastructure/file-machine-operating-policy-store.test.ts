import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileMachineOperatingPolicyStore } from "../../../src/power-management/infrastructure/file-machine-operating-policy-store.js";
import type { FileMachineOperatingPolicyStoreError } from "../../../src/power-management/infrastructure/file-machine-operating-policy-store.js";
import { createMachineOperatingPolicy } from "../../../src/power-management/domain/machine-operating-policy.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileMachineOperatingPolicyStore", () => {
  it("returns null when no policy has been persisted", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-machine-policy-"));
    directories.push(directory);
    const path = join(directory, "policy.json");

    await expect(
      new FileMachineOperatingPolicyStore(path).find(),
    ).resolves.toBeNull();
  });

  it("persists a canonical policy and reconstructs it after reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-machine-policy-"));
    directories.push(directory);
    const path = join(directory, "policy.json");
    const policy = createMachineOperatingPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows: [{ dayOfWeek: "monday", start: "08:00", end: "18:00" }],
      },
    });

    const first = new FileMachineOperatingPolicyStore(path);
    await first.save(policy);
    const reopened = new FileMachineOperatingPolicyStore(path);

    await expect(reopened.find()).resolves.toMatchObject({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      weeklySchedule: {
        windows:
          policy.mode === "scheduled" ? policy.weeklySchedule.windows : [],
      },
    });
    await expect(readFile(path, "utf8")).resolves.toContain('"version":1');
  });

  it("removes a persisted policy back to null", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-machine-policy-"));
    directories.push(directory);
    const path = join(directory, "policy.json");
    const store = new FileMachineOperatingPolicyStore(path);
    await store.save(createMachineOperatingPolicy({ mode: "manual" }));
    await expect(store.find()).resolves.toMatchObject({ mode: "manual" });

    await store.remove();
    await expect(store.find()).resolves.toBeNull();
  });

  it("serializes concurrent writes without interleaving", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-machine-policy-"));
    directories.push(directory);
    const path = join(directory, "policy.json");
    const store = new FileMachineOperatingPolicyStore(path);

    await Promise.all([
      store.save(createMachineOperatingPolicy({ mode: "always_on" })),
      store.save(createMachineOperatingPolicy({ mode: "manual" })),
      store.remove(),
    ]);

    // The queue serializes operations in call order, so the final state is
    // deterministically whatever the last-enqueued operation produced.
    await expect(store.find()).resolves.toBeNull();
  });

  it("rejects malformed persisted state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-machine-policy-"));
    directories.push(directory);
    const path = join(directory, "policy.json");
    await writeFile(path, '{"version":1,"policy":{"mode":"invalid"}}');

    await expect(
      new FileMachineOperatingPolicyStore(path).find(),
    ).rejects.toMatchObject({
      code: "invalid_policy_file",
    } satisfies Partial<FileMachineOperatingPolicyStoreError>);
  });
});
