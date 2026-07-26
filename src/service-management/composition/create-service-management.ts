import { CancelRegisteredServiceAvailabilityOverride } from "../application/cancel-registered-service-availability-override.js";
import { ControlRegisteredService } from "../application/control-registered-service.js";
import { ExecuteRegisteredServiceAvailabilityReconciliation } from "../application/execute-registered-service-availability-reconciliation.js";
import { ExecuteRegisteredServiceAvailabilityReconciliationOccurrence } from "../application/execute-registered-service-availability-reconciliation-occurrence.js";
import { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "../application/generate-registered-service-availability-reconciliation-occurrences.js";
import { GetRegisteredServiceEffectiveAvailability } from "../application/get-registered-service-effective-availability.js";
import { GetRegisteredServiceStatus } from "../application/get-registered-service-status.js";
import { ListRegisteredServices } from "../application/list-registered-services.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../application/plan-registered-service-availability-reconciliation.js";
import type { Clock } from "../application/ports/clock.js";
import type { ServiceAvailabilityOverrideStore } from "../application/ports/service-availability-override-store.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "../application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import { RunServiceAvailabilityReconciliationSchedulerCycle } from "../application/run-service-availability-reconciliation-scheduler-cycle.js";
import { RunServiceAvailabilityReconciliationTick } from "../application/run-service-availability-reconciliation-tick.js";
import { SetRegisteredServiceAvailabilityOverride } from "../application/set-registered-service-availability-override.js";
import { DispatchingServiceController } from "../infrastructure/dispatching-service-controller.js";
import { DispatchingServiceStatusReader } from "../infrastructure/dispatching-service-status-reader.js";
import { createRegisteredServiceCatalogFromEnvironment } from "../infrastructure/environment-registered-service-catalog.js";
import { InMemoryServiceAvailabilityOverrideStore } from "../infrastructure/in-memory-service-availability-override-store.js";
import { InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore } from "../infrastructure/in-memory-service-availability-reconciliation-occurrence-claim-store.js";
import { InMemoryServiceAvailabilityReconciliationSchedulerCursorStore } from "../infrastructure/in-memory-service-availability-reconciliation-scheduler-cursor-store.js";
import { MockServiceController } from "../infrastructure/mock-service-controller.js";
import {
  MockServiceStatusReader,
  type MockServiceStatusConfiguration,
} from "../infrastructure/mock-service-status-reader.js";
import {
  NodePm2ProcessListExecutor,
  type Pm2ProcessListExecutor,
} from "../infrastructure/pm2-process-list-executor.js";
import {
  NodePm2ServiceControlExecutor,
  type Pm2ServiceControlExecutor,
} from "../infrastructure/pm2-service-control-executor.js";
import { Pm2ServiceController } from "../infrastructure/pm2-service-controller.js";
import { Pm2ServiceStatusReader } from "../infrastructure/pm2-service-status-reader.js";

export interface ServiceManagementCapabilities {
  readonly listRegisteredServices: ListRegisteredServices;
  readonly getRegisteredServiceStatus: GetRegisteredServiceStatus;
  readonly controlRegisteredService: ControlRegisteredService;
  readonly setRegisteredServiceAvailabilityOverride: SetRegisteredServiceAvailabilityOverride;
  readonly cancelRegisteredServiceAvailabilityOverride: CancelRegisteredServiceAvailabilityOverride;
  readonly getRegisteredServiceEffectiveAvailability: GetRegisteredServiceEffectiveAvailability;
  readonly planRegisteredServiceAvailabilityReconciliation: PlanRegisteredServiceAvailabilityReconciliation;
  readonly executeRegisteredServiceAvailabilityReconciliation: ExecuteRegisteredServiceAvailabilityReconciliation;
  readonly executeRegisteredServiceAvailabilityReconciliationOccurrence: ExecuteRegisteredServiceAvailabilityReconciliationOccurrence;
  readonly generateRegisteredServiceAvailabilityReconciliationOccurrences: GenerateRegisteredServiceAvailabilityReconciliationOccurrences;
  readonly runServiceAvailabilityReconciliationTick: RunServiceAvailabilityReconciliationTick;
  readonly runServiceAvailabilityReconciliationSchedulerCycle: RunServiceAvailabilityReconciliationSchedulerCycle;
}

export interface ServiceManagementCompositionOverrides {
  readonly clock?: Clock;
  readonly serviceAvailabilityOverrideStore?: ServiceAvailabilityOverrideStore;
  readonly serviceAvailabilityReconciliationOccurrenceClaimStore?: ServiceAvailabilityReconciliationOccurrenceClaimStore;
  readonly serviceAvailabilityReconciliationSchedulerCursorStore?: ServiceAvailabilityReconciliationSchedulerCursorStore;
  readonly mockStatusConfiguration?: readonly MockServiceStatusConfiguration[];
  readonly pm2ProcessListExecutor?: Pm2ProcessListExecutor;
  readonly pm2ControlExecutor?: Pm2ServiceControlExecutor;
}

export function createServiceManagement(
  environment: Readonly<Record<string, string | undefined>>,
  overrides?: ServiceManagementCompositionOverrides,
): ServiceManagementCapabilities {
  const catalog = createRegisteredServiceCatalogFromEnvironment(environment);
  const clock = overrides?.clock ?? createSystemClock();
  const overrideStore =
    overrides?.serviceAvailabilityOverrideStore ??
    new InMemoryServiceAvailabilityOverrideStore();
  const occurrenceClaimStore =
    overrides?.serviceAvailabilityReconciliationOccurrenceClaimStore ??
    new InMemoryServiceAvailabilityReconciliationOccurrenceClaimStore();
  const schedulerCursorStore =
    overrides?.serviceAvailabilityReconciliationSchedulerCursorStore ??
    new InMemoryServiceAvailabilityReconciliationSchedulerCursorStore();
  const mockStatusConfiguration = overrides?.mockStatusConfiguration ?? [];
  const processListExecutor =
    overrides?.pm2ProcessListExecutor ?? new NodePm2ProcessListExecutor();
  const controlExecutor =
    overrides?.pm2ControlExecutor ?? new NodePm2ServiceControlExecutor();

  const mockStatusReader = MockServiceStatusReader.create(
    mockStatusConfiguration,
  );
  const mockController = new MockServiceController();
  const pm2StatusReader = new Pm2ServiceStatusReader(processListExecutor);
  const pm2Controller = new Pm2ServiceController(
    processListExecutor,
    controlExecutor,
  );
  const statusReader = new DispatchingServiceStatusReader({
    mock: mockStatusReader,
    pm2: pm2StatusReader,
  });
  const controller = new DispatchingServiceController({
    mock: mockController,
    pm2: pm2Controller,
  });
  const listRegisteredServices = new ListRegisteredServices(catalog);
  const controlRegisteredService = new ControlRegisteredService(
    catalog,
    controller,
    clock,
  );
  const planRegisteredServiceAvailabilityReconciliation =
    new PlanRegisteredServiceAvailabilityReconciliation(
      catalog,
      overrideStore,
      statusReader,
      clock,
    );
  const executeRegisteredServiceAvailabilityReconciliation =
    new ExecuteRegisteredServiceAvailabilityReconciliation(
      planRegisteredServiceAvailabilityReconciliation,
      controlRegisteredService,
    );
  const executeRegisteredServiceAvailabilityReconciliationOccurrence =
    new ExecuteRegisteredServiceAvailabilityReconciliationOccurrence(
      planRegisteredServiceAvailabilityReconciliation,
      occurrenceClaimStore,
      controlRegisteredService,
    );
  const generateRegisteredServiceAvailabilityReconciliationOccurrences =
    new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(catalog);
  const runServiceAvailabilityReconciliationTick =
    new RunServiceAvailabilityReconciliationTick(
      listRegisteredServices,
      generateRegisteredServiceAvailabilityReconciliationOccurrences,
      executeRegisteredServiceAvailabilityReconciliationOccurrence,
    );
  const runServiceAvailabilityReconciliationSchedulerCycle =
    new RunServiceAvailabilityReconciliationSchedulerCycle(
      clock,
      schedulerCursorStore,
      runServiceAvailabilityReconciliationTick,
    );

  return Object.freeze({
    listRegisteredServices,
    getRegisteredServiceStatus: new GetRegisteredServiceStatus(
      catalog,
      statusReader,
      clock,
    ),
    controlRegisteredService,
    setRegisteredServiceAvailabilityOverride:
      new SetRegisteredServiceAvailabilityOverride(
        catalog,
        overrideStore,
        clock,
      ),
    cancelRegisteredServiceAvailabilityOverride:
      new CancelRegisteredServiceAvailabilityOverride(catalog, overrideStore),
    getRegisteredServiceEffectiveAvailability:
      new GetRegisteredServiceEffectiveAvailability(
        catalog,
        overrideStore,
        clock,
      ),
    planRegisteredServiceAvailabilityReconciliation,
    executeRegisteredServiceAvailabilityReconciliation,
    executeRegisteredServiceAvailabilityReconciliationOccurrence,
    generateRegisteredServiceAvailabilityReconciliationOccurrences,
    runServiceAvailabilityReconciliationTick,
    runServiceAvailabilityReconciliationSchedulerCycle,
  });
}

function createSystemClock(): Clock {
  return Object.freeze({
    now: (): Date => new Date(),
  });
}
