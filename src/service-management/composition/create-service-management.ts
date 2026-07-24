import { ControlRegisteredService } from "../application/control-registered-service.js";
import { GetRegisteredServiceStatus } from "../application/get-registered-service-status.js";
import { ListRegisteredServices } from "../application/list-registered-services.js";
import type { Clock } from "../application/ports/clock.js";
import { DispatchingServiceController } from "../infrastructure/dispatching-service-controller.js";
import { DispatchingServiceStatusReader } from "../infrastructure/dispatching-service-status-reader.js";
import { createRegisteredServiceCatalogFromEnvironment } from "../infrastructure/environment-registered-service-catalog.js";
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
}

export interface ServiceManagementCompositionOverrides {
  readonly clock?: Clock;
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

  return Object.freeze({
    listRegisteredServices: new ListRegisteredServices(catalog),
    getRegisteredServiceStatus: new GetRegisteredServiceStatus(
      catalog,
      statusReader,
      clock,
    ),
    controlRegisteredService: new ControlRegisteredService(
      catalog,
      controller,
      clock,
    ),
  });
}

function createSystemClock(): Clock {
  return Object.freeze({
    now: (): Date => new Date(),
  });
}
