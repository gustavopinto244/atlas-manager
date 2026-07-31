import { vi } from "vitest";
import type { OrchestrateRegisteredServiceControlPort } from "../../src/service-management/application/orchestrate-registered-service-control.js";
import type { OrchestrationResult } from "../../src/service-management/domain/orchestration-plan.js";

export function createOrchestrationResult(
  targetServiceId: string,
  operation: "start" | "stop" | "restart",
  startedAt: string,
  completedAt: string,
): OrchestrationResult {
  return Object.freeze({
    targetServiceId,
    requestedOperation: operation,
    startedAt,
    completedAt,
    steps: Object.freeze([]),
    successful: true,
  });
}

export interface MockOrchestrateRegisteredServiceControl extends OrchestrateRegisteredServiceControlPort {
  readonly execute: ReturnType<
    typeof vi.fn<OrchestrateRegisteredServiceControlPort["execute"]>
  >;
}

export function createMockOrchestrate(): MockOrchestrateRegisteredServiceControl {
  return {
    execute: vi
      .fn<OrchestrateRegisteredServiceControlPort["execute"]>()
      .mockImplementation(
        async (
          targetServiceId: string,
          operation: "start" | "stop" | "restart",
        ): Promise<OrchestrationResult> =>
          createOrchestrationResult(
            targetServiceId,
            operation,
            new Date().toISOString(),
            new Date().toISOString(),
          ),
      ),
  };
}
