/* eslint-disable @typescript-eslint/unbound-method */
import { describe, expect, it, vi } from "vitest";

import { createServiceManagement } from "../../../src/service-management/composition/create-service-management.js";
import type { ServiceController } from "../../../src/service-management/application/ports/service-controller.js";
import type { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { ServiceControlOperation } from "../../../src/service-management/domain/registered-service-control-result.js";
import {
  createControlledTime,
  createSequenceReadinessReader,
} from "../../test-helpers/controlled-time.js";

const SERVICE_ID = "test-service";
const EXTERNAL_RESOURCE_ID = "test-resource";
const INITIAL_TIME = new Date("2026-07-27T12:00:00.000Z");
const POLL_INTERVAL_MS = 500;

function createEnvironment(): Readonly<Record<string, string | undefined>> {
  return {
    REGISTERED_SERVICES_JSON: JSON.stringify([
      {
        id: SERVICE_ID,
        displayName: "Test Service",
        managementAdapter: "mock",
        externalResourceId: EXTERNAL_RESOURCE_ID,
        supportedOperations: ["readStatus", "start", "stop", "restart"],
        availabilityPolicy: { mode: "manual" },
      },
    ]),
  };
}

describe("createServiceManagement readiness composition", () => {
  it("executes composed start orchestration with controlled readiness polling", async () => {
    const controlledTime = createControlledTime(INITIAL_TIME);
    const readinessReader = createSequenceReadinessReader(SERVICE_ID, [
      "not_ready",
      "ready",
    ]);

    const controllerCalls: Array<{
      serviceId: string;
      operation: ServiceControlOperation;
    }> = [];
    const mockController: ServiceController = {
      execute: vi.fn(
        async (
          service: RegisteredService,
          operation: ServiceControlOperation,
        ) => {
          controllerCalls.push({
            serviceId: service.id,
            operation,
          });
        },
      ),
    };

    const capabilities = createServiceManagement(createEnvironment(), {
      clock: controlledTime.clock,
      serviceReadinessTimer: controlledTime.timer,
      serviceReadinessReader: readinessReader,
      serviceController: mockController,
      mockStatusConfiguration: [
        { externalResourceId: EXTERNAL_RESOURCE_ID, state: "stopped" },
      ],
    });

    const result =
      await capabilities.orchestrateRegisteredServiceControl.execute(
        SERVICE_ID,
        "start",
      );

    // Assert controller.execute called once with start
    expect(mockController.execute).toHaveBeenCalledOnce();
    expect(controllerCalls).toHaveLength(1);
    expect(controllerCalls[0]?.serviceId).toBe(SERVICE_ID);
    expect(controllerCalls[0]?.operation).toBe("start");

    // Assert readinessReader.check called twice
    expect(readinessReader.calls).toBe(2);

    // Assert clock advanced by pollInterval
    const finalTime = controlledTime.now();
    const expectedFinalTime = new Date(
      INITIAL_TIME.getTime() + POLL_INTERVAL_MS,
    );
    expect(finalTime.getTime()).toBe(expectedFinalTime.getTime());

    // Assert result.successful === true
    expect(result.successful).toBe(true);

    // Assert result contains expected steps
    expect(result.steps).toHaveLength(2);

    // Step 0: control:start executed
    expect(result.steps[0]?.serviceId).toBe(SERVICE_ID);
    expect(result.steps[0]?.kind).toBe("control");
    expect(result.steps[0]?.operation).toBe("start");
    expect(result.steps[0]?.outcome.kind).toBe("executed");

    // Step 1: wait_for_readiness ready
    expect(result.steps[1]?.serviceId).toBe(SERVICE_ID);
    expect(result.steps[1]?.kind).toBe("wait_for_readiness");
    expect(result.steps[1]?.outcome.kind).toBe("ready");

    // Assert no failed steps
    const failedSteps = result.steps.filter(
      (step) => step.outcome.kind === "failed",
    );
    expect(failedSteps).toHaveLength(0);

    // Assert result metadata
    expect(result.targetServiceId).toBe(SERVICE_ID);
    expect(result.requestedOperation).toBe("start");
    expect(result.startedAt).toBe(INITIAL_TIME.toISOString());
  });
});
