import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FileServiceAvailabilityPolicyStore } from "../../../src/service-management/infrastructure/file-service-availability-policy-store.js";
import type { FileServiceAvailabilityPolicyStoreError } from "../../../src/service-management/infrastructure/file-service-availability-policy-store.js";
import { createServiceAvailabilityPolicy } from "../../../src/service-scheduling/domain/service-availability-policy.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("FileServiceAvailabilityPolicyStore", () => {
  it("persists canonical policies and reconstructs them after reopening", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-policy-store-"));
    directories.push(directory);
    const path = join(directory, "policies.json");
    const policy = createServiceAvailabilityPolicy({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      windows: [{ weekday: "monday", start: "08:00", end: "18:00" }],
    });
    if (policy.mode !== "scheduled") throw new Error("test policy mode");

    const first = new FileServiceAvailabilityPolicyStore(path);
    await first.save("task-manager", {
      mode: policy.mode,
      timezone: policy.timezone,
      schedule: policy.schedule,
    });
    const reopened = new FileServiceAvailabilityPolicyStore(path);

    await expect(
      reopened.findByServiceId("task-manager"),
    ).resolves.toMatchObject({
      mode: "scheduled",
      timezone: "America/Sao_Paulo",
      schedule: { windows: policy.schedule.windows },
    });
    await expect(readFile(path, "utf8")).resolves.toContain('"version":1');
  });

  it("rejects malformed persisted state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "atlas-policy-store-"));
    directories.push(directory);
    const path = join(directory, "policies.json");
    await writeFile(
      path,
      '{"version":1,"policies":[{"serviceId":"x","policy":{"mode":"invalid"}}]}',
    );

    await expect(
      new FileServiceAvailabilityPolicyStore(path).findByServiceId("x"),
    ).rejects.toMatchObject({
      code: "invalid_policy_file",
    } satisfies Partial<FileServiceAvailabilityPolicyStoreError>);
  });
});
