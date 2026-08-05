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
import type { AdministrativeServicesRouteDependencies } from "./administrative-services-route.js";
import type { AdministrativeServiceAvailabilityRouteDependencies } from "./administrative-service-availability-route.js";
import type { AdministrativeOverviewRouteDependencies } from "./administrative-overview-route.js";
import type { AdministrativeDashboardRouteDependencies } from "./administrative-dashboard-route.js";
import type { GetServerHealthCapability } from "../server-health/http/server-health-handler.js";
import type { BackupManagementCapabilities } from "../backup-management/composition/create-backup-management.js";
import type { AdministrativeBackupsRouteDependencies } from "./administrative-backups-route.js";
import type { AdministrativeEventHistoryOperationsRouteDependencies } from "./administrative-event-history-operations-route.js";
import type { AdministrativeSecurityStatusRouteDependencies } from "./administrative-security-status-route.js";
import type { AdministrativeIdentityReadiness } from "../access-control/domain/administrative-identity-readiness.js";
import {
  ADMINISTRATIVE_ROUTE_SECURITY_CATALOG,
  expectedAdministrativeRouteIds,
} from "./administrative-route-security-catalog.js";

export interface AdministrativeRuntime {
  readonly eventHistory?: AdministrativeEventHistoryRouteDependencies;
  readonly wakeAlarm?: AdministrativeWakeAlarmRouteDependencies;
  readonly shutdown?: AdministrativeShutdownRouteDependencies;
  readonly services?: AdministrativeServicesRouteDependencies;
  readonly availability?: AdministrativeServiceAvailabilityRouteDependencies;
  readonly overview?: AdministrativeOverviewRouteDependencies;
  readonly dashboard?: AdministrativeDashboardRouteDependencies;
  readonly backups?: AdministrativeBackupsRouteDependencies;
  readonly eventHistoryOperations?: AdministrativeEventHistoryOperationsRouteDependencies;
  readonly securityStatus?: AdministrativeSecurityStatusRouteDependencies;
  readonly routeCatalogStatus: Readonly<{ markReconciled(): void }>;
}

export interface AdministrativeRuntimeCompositionDependencies extends ConfiguredPowerManagementRuntimeDependencies {
  readonly eventHistory?: EventHistoryCapabilities;
  readonly powerManagement?: PowerManagementCapabilities;
  readonly getServerHealth?: GetServerHealthCapability;
  readonly applicationVersion?: string;
  readonly backupManagement?: BackupManagementCapabilities;
}

export function createAdministrativeRuntime(
  config: EnvironmentConfig,
  serviceManagement?: ServiceManagementCapabilities,
  compositionDependencies: AdministrativeRuntimeCompositionDependencies = {},
): AdministrativeRuntime {
  const filePath = config.administrativeEventHistoryFilePath;
  const directoryPath = config.administrativeEventHistoryDirectoryPath;
  const roleAssignments = config.administrativeRoleAssignments;
  const cloudflareAccess = config.cloudflareAccess;
  if (
    (filePath === undefined && directoryPath === undefined) ||
    roleAssignments === undefined
  )
    throw new Error("Administrative configuration is incomplete");
  if (cloudflareAccess === undefined)
    throw new Error("Cloudflare Access configuration is incomplete");

  const clock: AdministrativeRequestClock = Object.freeze({
    now: () => new Date(),
  });
  const eventHistory =
    compositionDependencies.eventHistory ??
    (directoryPath === undefined
      ? createEventHistory({ filePath: filePath! })
      : createEventHistory({ directoryPath }));
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
  let routeCatalogReconciled = false;
  const routeCatalogStatus = Object.freeze({
    markReconciled: () => {
      routeCatalogReconciled = true;
    },
  });
  const enabledActivationFlags = [
    ...(config.administrativeDashboardEnabled
      ? ["ADMINISTRATIVE_DASHBOARD_ENABLED"]
      : []),
    ...(config.administrativeEventHistoryHttpEnabled
      ? ["ADMINISTRATIVE_EVENT_HISTORY_HTTP_ENABLED"]
      : []),
    ...(config.administrativeEventHistoryOperationsHttpEnabled
      ? ["ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED"]
      : []),
    ...(config.administrativeWakeAlarmHttpEnabled
      ? ["ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED"]
      : []),
    ...(config.administrativeShutdownHttpEnabled
      ? ["ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED"]
      : []),
    ...(config.administrativeServiceManagementHttpEnabled
      ? ["ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED"]
      : []),
    ...(config.administrativeServiceAvailabilityHttpEnabled
      ? ["ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED"]
      : []),
    ...(config.administrativeOverviewHttpEnabled
      ? ["ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED"]
      : []),
    ...(config.administrativeBackupHttpEnabled
      ? ["ADMINISTRATIVE_BACKUP_HTTP_ENABLED"]
      : []),
    ...(config.administrativeSecurityStatusHttpEnabled
      ? ["ADMINISTRATIVE_SECURITY_STATUS_HTTP_ENABLED"]
      : []),
  ];
  const enabledRouteCount = expectedAdministrativeRouteIds(
    enabledActivationFlags,
  ).length;
  const activationFlagCount = new Set(
    ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.map(
      (descriptor) => descriptor.activationFlag,
    ),
  ).size;
  const securityPostureReader = Object.freeze({
    execute: async (): Promise<unknown> => {
      const identityReadiness: AdministrativeIdentityReadiness =
        await cloudflareAuthentication.readIdentityProviderReadiness();
      return Object.freeze({
        identityReadiness,
        routeCatalog: Object.freeze({
          reconciled: routeCatalogReconciled,
          routeCount: enabledRouteCount,
        }),
        featureCounts: Object.freeze({
          enabled: enabledActivationFlags.length,
          disabled: activationFlagCount - enabledActivationFlags.length,
        }),
        loopbackBinding: config.host === "127.0.0.1",
        noApplicationSession: true,
        corsDisabled: true,
        trustProxyDisabled: true,
        auditAvailable: eventHistory !== undefined,
      });
    },
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
  const serviceMutationGate = new FixedAdministrativePowerOperationGate();
  const eventHistoryMaintenanceGate =
    new FixedAdministrativePowerOperationGate();

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
      ...(serviceManagement === undefined ? {} : { serviceManagement }),
      ...(compositionDependencies.backupManagement === undefined
        ? {}
        : { backupManagement: compositionDependencies.backupManagement }),
      ...(eventHistory.operations === undefined
        ? {}
        : { eventHistoryOperations: eventHistory.operations }),
      ...(confirmationReader === undefined
        ? {}
        : { machineShutdownConfirmationReader: confirmationReader }),
      securityPostureReader,
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
    ...((config.administrativeServiceManagementHttpEnabled ?? false)
      ? {
          services: Object.freeze({
            admission,
            mutationGate: serviceMutationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...((config.administrativeServiceAvailabilityHttpEnabled ?? false)
      ? {
          availability: Object.freeze({
            admission,
            mutationGate: serviceMutationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...((config.administrativeOverviewHttpEnabled ?? false)
      ? {
          overview: Object.freeze({
            admission,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
            getServerHealth: compositionDependencies.getServerHealth ?? {
              execute: () => Promise.resolve({ status: "ok" }),
            },
            applicationVersion:
              compositionDependencies.applicationVersion ?? "1.0.0-rc.7",
          }),
        }
      : {}),
    ...((config.administrativeDashboardEnabled ?? false)
      ? {
          dashboard: Object.freeze({
            admission,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...((config.administrativeBackupHttpEnabled ?? false)
      ? {
          backups: Object.freeze({
            admission,
            mutationGate: serviceMutationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...(config.administrativeEventHistoryOperationsHttpEnabled === true
      ? {
          eventHistoryOperations: Object.freeze({
            admission,
            mutationGate: eventHistoryMaintenanceGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...(config.administrativeSecurityStatusHttpEnabled === true
      ? {
          securityStatus: Object.freeze({
            admission,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    routeCatalogStatus,
  });
}
