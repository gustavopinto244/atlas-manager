import { describe, expect, it } from "vitest";

import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import {
  MockServiceStatusReader,
  MockServiceStatusReaderError,
  type MockServiceStatusConfiguration,
  type MockServiceStatusReaderErrorCode,
} from "../../../src/service-management/infrastructure/mock-service-status-reader.js";

function createService(
  externalResourceId: string,
  managementAdapter: "mock" | "pm2" = "mock",
): RegisteredService {
  return RegisteredService.create({
    id: managementAdapter === "mock" ? "mock-service" : "pm2-service",
    displayName: "Test Service",
    managementAdapter,
    externalResourceId,
    supportedOperations: ["readStatus"],
  });
}

function expectReaderCreationError(
  configuration: readonly MockServiceStatusConfiguration[],
  code: MockServiceStatusReaderErrorCode,
): void {
  expect(() => MockServiceStatusReader.create(configuration)).toThrowError(
    expect.objectContaining({
      name: "MockServiceStatusReaderError",
      code,
    }),
  );
}

describe("MockServiceStatusReader", () => {
  it.each(["running", "stopped", "failed", "unknown"] as const)(
    "reports the configured %s state",
    async (state) => {
      const externalResourceId = `${state}-fixture`;
      const reader = MockServiceStatusReader.create([
        { externalResourceId, state },
      ]);

      await expect(
        reader.read(createService(externalResourceId)),
      ).resolves.toBe(state);
    },
  );

  it("supports multiple configured mock targets with exact matching", async () => {
    const reader = MockServiceStatusReader.create([
      { externalResourceId: "first-fixture", state: "running" },
      { externalResourceId: "second-fixture", state: "stopped" },
      { externalResourceId: "Second-Fixture", state: "failed" },
    ]);

    await expect(reader.read(createService("first-fixture"))).resolves.toBe(
      "running",
    );
    await expect(reader.read(createService("second-fixture"))).resolves.toBe(
      "stopped",
    );
    await expect(reader.read(createService("Second-Fixture"))).resolves.toBe(
      "failed",
    );
  });

  it("rejects duplicate configured external targets", () => {
    const duplicateTarget = "private-fixture";

    expectReaderCreationError(
      [
        { externalResourceId: duplicateTarget, state: "running" },
        { externalResourceId: duplicateTarget, state: "stopped" },
      ],
      "duplicate_mock_status_target",
    );
  });

  it("rejects an unsupported configured runtime state", () => {
    expectReaderCreationError(
      [{ externalResourceId: "fixture", state: "starting" }],
      "invalid_mock_status_state",
    );
  });

  it("rejects an unconfigured mock target", async () => {
    const reader = MockServiceStatusReader.create([]);

    await expect(reader.read(createService("missing-fixture"))).rejects.toEqual(
      expect.objectContaining({ code: "service_status_unavailable" }),
    );
  });

  it("rejects a service assigned to the PM2 adapter", async () => {
    const reader = MockServiceStatusReader.create([
      { externalResourceId: "pm2-process", state: "running" },
    ]);

    await expect(
      reader.read(createService("pm2-process", "pm2")),
    ).rejects.toEqual(
      expect.objectContaining({ code: "unsupported_status_adapter" }),
    );
  });

  it("does not retain the caller-owned configuration", async () => {
    const configuration: MockServiceStatusConfiguration[] = [
      { externalResourceId: "fixture", state: "running" },
    ];
    const reader = MockServiceStatusReader.create(configuration);

    configuration[0] = {
      externalResourceId: "fixture",
      state: "stopped",
    };
    configuration.push({
      externalResourceId: "later-fixture",
      state: "failed",
    });

    await expect(reader.read(createService("fixture"))).resolves.toBe(
      "running",
    );
    await expect(reader.read(createService("later-fixture"))).rejects.toEqual(
      expect.objectContaining({ code: "service_status_unavailable" }),
    );
  });

  it("does not expose identifiers or configured data in errors", () => {
    const rejectedTarget = "credential-secret-fixture";

    try {
      MockServiceStatusReader.create([
        { externalResourceId: rejectedTarget, state: "running" },
        { externalResourceId: rejectedTarget, state: "failed" },
      ]);
    } catch (error) {
      expect(error).toBeInstanceOf(MockServiceStatusReaderError);
      expect(String(error)).not.toContain(rejectedTarget);
      expect(String(error)).not.toContain("running");
      expect(String(error)).not.toContain("failed");
    }
  });
});
