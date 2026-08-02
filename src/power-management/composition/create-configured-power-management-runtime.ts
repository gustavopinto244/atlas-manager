import type { EnvironmentConfig } from "../../config/environment.js";
import type { EventHistoryCapabilities } from "../../event-history/composition/create-event-history.js";
import type { ServiceManagementCapabilities } from "../../service-management/composition/create-service-management.js";
import {
  createConfiguredPowerManagementInfrastructure,
  type ConfiguredPowerManagementInfrastructureDependencies,
} from "./create-configured-power-management-infrastructure.js";
import {
  createPowerManagement,
  type PowerManagementCapabilities,
  type PowerManagementCompositionOverrides,
} from "./create-power-management.js";

export interface ConfiguredPowerManagementRuntimeDependencies extends ConfiguredPowerManagementInfrastructureDependencies {
  readonly createPowerManagement?: (
    overrides: PowerManagementCompositionOverrides,
  ) => PowerManagementCapabilities;
}

export function createConfiguredPowerManagementRuntime(
  config: EnvironmentConfig,
  serviceManagement: ServiceManagementCapabilities | undefined,
  eventHistory: EventHistoryCapabilities,
  dependencies: ConfiguredPowerManagementRuntimeDependencies = {},
): PowerManagementCapabilities {
  const infrastructure = createConfiguredPowerManagementInfrastructure(
    config.powerManagementBackend,
    dependencies,
  );
  const createCapabilities =
    dependencies.createPowerManagement ?? createPowerManagement;

  return createCapabilities({
    administrativeEventHistoryCapabilities: eventHistory,
    machineOperatingPolicy: config.machineOperatingPolicy,
    ...infrastructure.adapters,
    ...(config.machineShutdownOccurrenceClaimFilePath === undefined ||
    config.machinePowerSchedulerCursorFilePath === undefined
      ? {}
      : {
          persistence: {
            occurrenceClaimFilePath:
              config.machineShutdownOccurrenceClaimFilePath,
            schedulerCursorFilePath: config.machinePowerSchedulerCursorFilePath,
          },
        }),
    ...(serviceManagement === undefined
      ? {}
      : {
          serviceManagementReadinessCapabilities: {
            listRegisteredServices: serviceManagement.listRegisteredServices,
            getRegisteredServiceAvailabilityForInterval:
              serviceManagement.getRegisteredServiceAvailabilityForInterval,
            getRegisteredServiceStatus:
              serviceManagement.getRegisteredServiceStatus,
          },
          serviceManagementPreparationCapabilities:
            serviceManagement.orchestrateRegisteredServicesStop,
        }),
  });
}
