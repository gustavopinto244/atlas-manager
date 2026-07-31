import { CancelRegisteredServiceAvailabilityOverride } from "../application/cancel-registered-service-availability-override.js";
import { ControlRegisteredService } from "../application/control-registered-service.js";
import { ExecuteRegisteredServiceAvailabilityReconciliation } from "../application/execute-registered-service-availability-reconciliation.js";
import { ExecuteRegisteredServiceAvailabilityReconciliationOccurrence } from "../application/execute-registered-service-availability-reconciliation-occurrence.js";
import { GenerateRegisteredServiceAvailabilityReconciliationOccurrences } from "../application/generate-registered-service-availability-reconciliation-occurrences.js";
import { GetRegisteredServiceEffectiveAvailability } from "../application/get-registered-service-effective-availability.js";
import { GetRegisteredServiceLogs } from "../application/get-registered-service-logs.js";
import { GetRegisteredServiceStatus } from "../application/get-registered-service-status.js";
import { ListRegisteredServices } from "../application/list-registered-services.js";
import {
  OrchestrateRegisteredServiceControl,
  type OrchestrateRegisteredServiceControlPort,
} from "../application/orchestrate-registered-service-control.js";
import { PlanRegisteredServiceAvailabilityReconciliation } from "../application/plan-registered-service-availability-reconciliation.js";
import type { Clock } from "../application/ports/clock.js";
import type { ServiceAvailabilityOverrideStore } from "../application/ports/service-availability-override-store.js";
import type { ServiceAvailabilityReconciliationOccurrenceClaimStore } from "../application/ports/service-availability-reconciliation-occurrence-claim-store.js";
import type { ServiceAvailabilityReconciliationSchedulerCursorStore } from "../application/ports/service-availability-reconciliation-scheduler-cursor-store.js";
import type { ServiceAvailabilityReconciliationSchedulerTimer } from "../application/ports/service-availability-reconciliation-scheduler-timer.js";
import type { ServiceReadinessTimer } from "../application/ports/service-readiness-timer.js";
import { PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims } from "../application/prune-completed-service-availability-reconciliation-occurrence-claims.js";
import { PruneExpiredRegisteredServiceAvailabilityOverrides } from "../application/prune-expired-registered-service-availability-overrides.js";
import { RunServiceAvailabilityReconciliationSchedulerCycle } from "../application/run-service-availability-reconciliation-scheduler-cycle.js";
import { RunServiceAvailabilityReconciliationTick } from "../application/run-service-availability-reconciliation-tick.js";
import { ServiceAvailabilityReconciliationSchedulerLoop } from "../application/service-availability-reconciliation-scheduler-loop.js";
import { SetRegisteredServiceAvailabilityOverride } from "../application/set-registered-service-availability-override.js";
import { WaitForRegisteredServiceReadiness } from "../application/wait-for-registered-service-readiness.js";
import { DefaultPlanRegisteredServiceOrchestration } from "../application/plan-registered-service-orchestration.js";
import { createDependencyGraph } from "../domain/dependency-graph.js";
import type { RegisteredServiceDependencyGraph } from "../domain/dependency-graph.js";
import { ComposeServiceController } from "../infrastructure/compose-service-controller.js";
import { ComposeServiceStatusReader } from "../infrastructure/compose-service-status-reader.js";
import { DispatchingServiceController } from "../infrastructure/dispatching-service-controller.js";
import { DispatchingServiceStatusReader } from "../infrastructure/dispatching-service-status-reader.js";
import type { DockerComposeProjectControlExecutor } from "../infrastructure/docker-compose-executors.js";
import type { DockerComposeProjectStatusExecutor } from "../infrastructure/docker-compose-executors.js";
import type { DockerComposeProjectLogExecutor } from "../infrastructure/docker-compose-executors.js";
import type { DockerContainerLogExecutor } from "../infrastructure/docker-compose-executors.js";
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
import { NodeServiceAvailabilityReconciliationSchedulerTimer } from "../infrastructure/node-service-availability-reconciliation-scheduler-timer.js";
import {
  NodePm2ServiceControlExecutor,
  type Pm2ServiceControlExecutor,
} from "../infrastructure/pm2-service-control-executor.js";
import { Pm2ServiceController } from "../infrastructure/pm2-service-controller.js";
import { Pm2ServiceStatusReader } from "../infrastructure/pm2-service-status-reader.js";
import { NodeDockerContainerInspectExecutor } from "../infrastructure/node-docker-container-inspect-executor.js";
import type { DockerContainerInspectExecutor } from "../infrastructure/docker-container-inspect-executor.js";
import type { DockerContainerStatsExecutor } from "../infrastructure/docker-container-stats-executor.js";
import { NodeDockerContainerControlExecutor } from "../infrastructure/node-docker-container-control-executor.js";
import type { DockerContainerControlExecutor } from "../infrastructure/docker-container-control-executor.js";
import { DockerServiceStatusReader } from "../infrastructure/docker-service-status-reader.js";
import { DockerServiceController } from "../infrastructure/docker-service-controller.js";
import {
  NodeDockerComposeProjectStatusExecutor,
  NodeDockerComposeProjectControlExecutor,
  NodeDockerComposeProjectLogExecutor,
  NodeDockerContainerLogExecutor,
} from "../infrastructure/node-docker-compose-executors.js";
import {
  DockerContainerLogReader,
  ComposeProjectLogReader,
  DispatchingServiceLogReader,
} from "../infrastructure/service-log-readers.js";
import {
  RuntimeReadinessReader,
  DockerHealthReadinessReader,
  ComposeHealthReadinessReader,
  createDispatchingReadinessReader,
  NodeServiceReadinessTimer,
} from "../infrastructure/readiness-infrastructure.js";
import type { ServiceReadinessReader } from "../application/ports/service-readiness-reader.js";

import type { ServiceController } from "../application/ports/service-controller.js";
import { GetRegisteredServiceAvailabilityForInterval } from "../application/get-registered-service-availability-for-interval.js";

export interface ServiceManagementCapabilities {
  readonly listRegisteredServices: ListRegisteredServices;
  readonly getRegisteredServiceStatus: GetRegisteredServiceStatus;
  readonly controlRegisteredService: ControlRegisteredService;
  readonly orchestrateRegisteredServiceControl: OrchestrateRegisteredServiceControlPort;
  readonly getRegisteredServiceLogs: GetRegisteredServiceLogs;
  readonly setRegisteredServiceAvailabilityOverride: SetRegisteredServiceAvailabilityOverride;
  readonly cancelRegisteredServiceAvailabilityOverride: CancelRegisteredServiceAvailabilityOverride;
  readonly getRegisteredServiceEffectiveAvailability: GetRegisteredServiceEffectiveAvailability;
  readonly getRegisteredServiceAvailabilityForInterval: GetRegisteredServiceAvailabilityForInterval;
  readonly pruneExpiredRegisteredServiceAvailabilityOverrides: PruneExpiredRegisteredServiceAvailabilityOverrides;
  readonly pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims: PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims;
  readonly planRegisteredServiceAvailabilityReconciliation: PlanRegisteredServiceAvailabilityReconciliation;
  readonly executeRegisteredServiceAvailabilityReconciliation: ExecuteRegisteredServiceAvailabilityReconciliation;
  readonly executeRegisteredServiceAvailabilityReconciliationOccurrence: ExecuteRegisteredServiceAvailabilityReconciliationOccurrence;
  readonly generateRegisteredServiceAvailabilityReconciliationOccurrences: GenerateRegisteredServiceAvailabilityReconciliationOccurrences;
  readonly runServiceAvailabilityReconciliationTick: RunServiceAvailabilityReconciliationTick;
  readonly runServiceAvailabilityReconciliationSchedulerCycle: RunServiceAvailabilityReconciliationSchedulerCycle;
  readonly serviceAvailabilityReconciliationSchedulerLoop: ServiceAvailabilityReconciliationSchedulerLoop;
}

export interface ServiceManagementCompositionOverrides {
  readonly clock?: Clock;
  readonly serviceAvailabilityOverrideStore?: ServiceAvailabilityOverrideStore;
  readonly serviceAvailabilityReconciliationOccurrenceClaimStore?: ServiceAvailabilityReconciliationOccurrenceClaimStore;
  readonly serviceAvailabilityReconciliationSchedulerCursorStore?: ServiceAvailabilityReconciliationSchedulerCursorStore;
  readonly serviceAvailabilityReconciliationSchedulerTimer?: ServiceAvailabilityReconciliationSchedulerTimer;
  readonly mockStatusConfiguration?: readonly MockServiceStatusConfiguration[];
  readonly pm2ProcessListExecutor?: Pm2ProcessListExecutor;
  readonly pm2ControlExecutor?: Pm2ServiceControlExecutor;
  readonly dockerContainerInspectExecutor?: DockerContainerInspectExecutor;
  readonly dockerContainerStatsExecutor?: DockerContainerStatsExecutor;
  readonly dockerContainerControlExecutor?: DockerContainerControlExecutor;
  readonly dockerComposeProjectStatusExecutor?: DockerComposeProjectStatusExecutor;
  readonly dockerComposeProjectControlExecutor?: DockerComposeProjectControlExecutor;
  readonly dockerComposeProjectLogExecutor?: DockerComposeProjectLogExecutor;
  readonly dockerContainerLogExecutor?: DockerContainerLogExecutor;
  readonly serviceReadinessTimer?: ServiceReadinessTimer;
  readonly serviceReadinessReader?: ServiceReadinessReader;
  readonly serviceController?: ServiceController;
  readonly orchestrateRegisteredServiceControl?: OrchestrateRegisteredServiceControlPort;
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
  const schedulerTimer =
    overrides?.serviceAvailabilityReconciliationSchedulerTimer ??
    new NodeServiceAvailabilityReconciliationSchedulerTimer();
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
  const dockerInspectExecutor =
    overrides?.dockerContainerInspectExecutor ??
    new NodeDockerContainerInspectExecutor();
  const dockerControlExecutor =
    overrides?.dockerContainerControlExecutor ??
    new NodeDockerContainerControlExecutor();
  const dockerStatusReader = new DockerServiceStatusReader(
    dockerInspectExecutor,
  );
  const dockerController = new DockerServiceController(
    dockerInspectExecutor,
    dockerControlExecutor,
  );
  const composeStatusExecutor =
    overrides?.dockerComposeProjectStatusExecutor ??
    new NodeDockerComposeProjectStatusExecutor();
  const composeControlExecutor =
    overrides?.dockerComposeProjectControlExecutor ??
    new NodeDockerComposeProjectControlExecutor();
  const composeLogExecutor =
    overrides?.dockerComposeProjectLogExecutor ??
    new NodeDockerComposeProjectLogExecutor();
  const containerLogExecutor =
    overrides?.dockerContainerLogExecutor ??
    new NodeDockerContainerLogExecutor();
  const composeStatusReader = new ComposeServiceStatusReader(
    composeStatusExecutor,
  );
  const composeController = new ComposeServiceController(
    composeControlExecutor,
  );
  const statusReader = new DispatchingServiceStatusReader({
    mock: mockStatusReader,
    pm2: pm2StatusReader,
    docker: dockerStatusReader,
    "docker-compose": composeStatusReader,
  });
  const controller =
    overrides?.serviceController ??
    new DispatchingServiceController({
      mock: mockController,
      pm2: pm2Controller,
      docker: dockerController,
      "docker-compose": composeController,
    });
  const containerLogReader = new DockerContainerLogReader(containerLogExecutor);
  const composeProjectLogReader = new ComposeProjectLogReader(
    composeLogExecutor,
  );
  const logReader = new DispatchingServiceLogReader(
    containerLogReader,
    composeProjectLogReader,
  );
  const getRegisteredServiceLogs = new GetRegisteredServiceLogs(
    catalog,
    logReader,
    clock,
  );

  const listRegisteredServices = new ListRegisteredServices(catalog);
  const controlRegisteredService = new ControlRegisteredService(
    catalog,
    controller,
    clock,
  );

  const graphPromise: Promise<RegisteredServiceDependencyGraph> = catalog
    .list()
    .then((services) =>
      createDependencyGraph(
        services.map((s) => ({
          serviceId: s.id,
          dependencies: s.dependencies,
        })),
      ),
    );
  const getGraph = (): Promise<RegisteredServiceDependencyGraph> =>
    graphPromise;

  const runtimeReadinessReader = new RuntimeReadinessReader(
    statusReader,
    clock,
  );
  const dispatchingReadinessReader =
    overrides?.serviceReadinessReader ??
    createDispatchingReadinessReader({
      runtimeReader: runtimeReadinessReader,
      dockerHealthReader: new DockerHealthReadinessReader(
        dockerInspectExecutor,
        clock,
      ),
      composeHealthReader: new ComposeHealthReadinessReader(
        composeStatusExecutor,
        clock,
      ),
    });
  const readinessTimer =
    overrides?.serviceReadinessTimer ?? new NodeServiceReadinessTimer();
  const waitForReadiness = new WaitForRegisteredServiceReadiness(
    catalog,
    dispatchingReadinessReader,
    readinessTimer,
    clock,
  );
  const getRegisteredServiceEffectiveAvailability =
    new GetRegisteredServiceEffectiveAvailability(
      catalog,
      overrideStore,
      clock,
    );
  const getRegisteredServiceAvailabilityForInterval =
    new GetRegisteredServiceAvailabilityForInterval(catalog, overrideStore);
  const orchestrateRegisteredServiceControl =
    overrides?.orchestrateRegisteredServiceControl ??
    new OrchestrateRegisteredServiceControl(
      catalog,
      controller,
      getGraph,
      waitForReadiness,
      clock,
      getRegisteredServiceEffectiveAvailability,
      statusReader,
      controlRegisteredService,
      new DefaultPlanRegisteredServiceOrchestration(),
    );
  const pruneExpiredRegisteredServiceAvailabilityOverrides =
    new PruneExpiredRegisteredServiceAvailabilityOverrides(
      listRegisteredServices,
      overrideStore,
      clock,
    );
  const pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims =
    new PruneCompletedServiceAvailabilityReconciliationOccurrenceClaims(
      schedulerCursorStore,
      occurrenceClaimStore,
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
      orchestrateRegisteredServiceControl,
    );
  const generateRegisteredServiceAvailabilityReconciliationOccurrences =
    new GenerateRegisteredServiceAvailabilityReconciliationOccurrences(catalog);
  const runServiceAvailabilityReconciliationTick =
    new RunServiceAvailabilityReconciliationTick(
      listRegisteredServices,
      generateRegisteredServiceAvailabilityReconciliationOccurrences,
      executeRegisteredServiceAvailabilityReconciliationOccurrence,
      getGraph,
    );
  const runServiceAvailabilityReconciliationSchedulerCycle =
    new RunServiceAvailabilityReconciliationSchedulerCycle(
      clock,
      schedulerCursorStore,
      runServiceAvailabilityReconciliationTick,
      pruneExpiredRegisteredServiceAvailabilityOverrides,
      pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    );
  const serviceAvailabilityReconciliationSchedulerLoop =
    new ServiceAvailabilityReconciliationSchedulerLoop(
      runServiceAvailabilityReconciliationSchedulerCycle,
      schedulerTimer,
    );

  return Object.freeze({
    listRegisteredServices,
    getRegisteredServiceStatus: new GetRegisteredServiceStatus(
      catalog,
      statusReader,
      clock,
    ),
    controlRegisteredService,
    orchestrateRegisteredServiceControl,
    getRegisteredServiceLogs,
    setRegisteredServiceAvailabilityOverride:
      new SetRegisteredServiceAvailabilityOverride(
        catalog,
        overrideStore,
        clock,
      ),
    cancelRegisteredServiceAvailabilityOverride:
      new CancelRegisteredServiceAvailabilityOverride(catalog, overrideStore),
    getRegisteredServiceEffectiveAvailability,
    getRegisteredServiceAvailabilityForInterval,
    pruneExpiredRegisteredServiceAvailabilityOverrides,
    pruneCompletedServiceAvailabilityReconciliationOccurrenceClaims,
    planRegisteredServiceAvailabilityReconciliation,
    executeRegisteredServiceAvailabilityReconciliation,
    executeRegisteredServiceAvailabilityReconciliationOccurrence,
    generateRegisteredServiceAvailabilityReconciliationOccurrences,
    runServiceAvailabilityReconciliationTick,
    runServiceAvailabilityReconciliationSchedulerCycle,
    serviceAvailabilityReconciliationSchedulerLoop,
  });
}

function createSystemClock(): Clock {
  return Object.freeze({
    now: (): Date => new Date(),
  });
}
