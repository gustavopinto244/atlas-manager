import type { EnvironmentConfig } from "../config/environment.js";
import { createAdministrativeAccessControl } from "../access-control/composition/create-administrative-access-control.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { createProtectedAdministration } from "../access-control/composition/create-protected-administration.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import {
  createEventHistory,
  type EventHistoryCapabilities,
} from "../event-history/composition/create-event-history.js";
import { type PowerManagementCapabilities } from "../power-management/composition/create-power-management.js";
import {
  createConfiguredPowerManagementRuntime,
  type ConfiguredPowerManagementRuntimeDependencies,
} from "../power-management/composition/create-configured-power-management-runtime.js";
import type { MachineShutdownConfirmationReader } from "../power-management/application/ports/machine-shutdown-readiness-readers.js";
import type { ServiceManagementCapabilities } from "../service-management/composition/create-service-management.js";
import type { AdministrativeEventHistoryPage } from "../event-history/domain/administrative-event-history-page.js";
import {
  FixedAdministrativeRequestAdmission,
  type AdministrativeRequestClock,
} from "./administrative-request-admission.js";
import { FixedAdministrativePowerOperationGate } from "./administrative-power-operation-gate.js";
import type { AdministrativeEventHistoryRouteDependencies } from "./administrative-event-history-route.js";
import type { AdministrativeWakeAlarmRouteDependencies } from "./administrative-wake-alarm-route.js";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import type { AdministrativeShutdownRouteDependencies } from "./administrative-shutdown-route.js";

export interface AdministrativeRuntime {
  readonly eventHistory?: AdministrativeEventHistoryRouteDependencies;
  readonly wakeAlarm?: AdministrativeWakeAlarmRouteDependencies;
  readonly shutdown?: AdministrativeShutdownRouteDependencies;
}

export interface AdministrativeRuntimeCompositionDependencies extends ConfiguredPowerManagementRuntimeDependencies {
  readonly eventHistory?: EventHistoryCapabilities;
  readonly powerManagement?: PowerManagementCapabilities;
}

export function createAdministrativeRuntime(
  config: EnvironmentConfig,
  serviceManagement?: ServiceManagementCapabilities,
  compositionDependencies: AdministrativeRuntimeCompositionDependencies = {},
): AdministrativeRuntime {
  const filePath = config.administrativeEventHistoryFilePath;
  const roleAssignments = config.administrativeRoleAssignments;
  const cloudflareAccess = config.cloudflareAccess;
  if (filePath === undefined || roleAssignments === undefined)
    throw new Error("Administrative configuration is incomplete");
  if (cloudflareAccess === undefined)
    throw new Error("Cloudflare Access configuration is incomplete");

  const clock: AdministrativeRequestClock = Object.freeze({
    now: () => new Date(),
  });
  const eventHistory =
    compositionDependencies.eventHistory ?? createEventHistory({ filePath });
  const roleAssignmentReader = new InMemoryAdministrativeRoleAssignmentReader({
    assignments: roleAssignments.map((assignment) => ({
      principalId: assignment.principal.principalId,
      roles: assignment.roles,
    })),
  });
  const cloudflareAuthentication =
    createCloudflareAccessAdministrativeAuthentication({
      configuration: cloudflareAccess,
      clock,
    });
  const needsPowerManagement =
    config.administrativeWakeAlarmHttpEnabled ||
    config.administrativeShutdownHttpEnabled;
  const powerManagement = needsPowerManagement
    ? (compositionDependencies.powerManagement ??
      createConfiguredPowerManagementRuntime(
        config,
        serviceManagement,
        eventHistory,
        compositionDependencies,
      ))
    : compositionDependencies.powerManagement;

  const admission = new FixedAdministrativeRequestAdmission(clock);
  const powerOperationGate = new FixedAdministrativePowerOperationGate();

  const createProtected = (
    reader: CloudflareAccessAssertionReader,
    confirmationReader?: MachineShutdownConfirmationReader,
  ) => {
    const accessControl = createAdministrativeAccessControl({
      authenticator:
        cloudflareAuthentication.createAuthenticationProviderForRequest(reader),
      roleAssignmentReader,
    });
    return createProtectedAdministration({
      accessControl,
      ...(powerManagement === undefined ? {} : { powerManagement }),
      eventHistory,
      clock,
      ...(confirmationReader === undefined
        ? {}
        : { machineShutdownConfirmationReader: confirmationReader }),
    });
  };

  return Object.freeze({
    ...(config.administrativeEventHistoryHttpEnabled
      ? {
          eventHistory: Object.freeze({
            admission,
            createProtectedEventHistoryQuery: (
              reader: CloudflareAccessAssertionReader,
            ) => {
              const protectedAdministration = createProtected(reader);
              return Object.freeze({
                execute: async (query: unknown) =>
                  (await protectedAdministration.getAdministrativeEventHistory.execute(
                    query,
                  )) as AdministrativeEventHistoryPage,
              });
            },
          }),
        }
      : {}),
    ...(config.administrativeWakeAlarmHttpEnabled
      ? {
          wakeAlarm: Object.freeze({
            admission,
            mutationGate: powerOperationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...(config.administrativeShutdownHttpEnabled
      ? {
          shutdown: Object.freeze({
            admission,
            powerOperationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
              confirmationReader: MachineShutdownConfirmationReader,
            ) => createProtected(reader, confirmationReader),
          }),
        }
      : {}),
  });
}
