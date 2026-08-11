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
import { APPLICATION_VERSION } from "../config/application-version.js";
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
import type { AdministrativeServiceScheduleRouteDependencies } from "./administrative-service-schedule-route.js";
import type { AdministrativeMachineScheduleRouteDependencies } from "./administrative-machine-schedule-route.js";
import { FileMachineOperatingPolicyStore } from "../power-management/infrastructure/file-machine-operating-policy-store.js";
import type { MachineOperatingPolicyStore } from "../power-management/application/ports/machine-operating-policy-store.js";
import type { AdministrativeOverviewRouteDependencies } from "./administrative-overview-route.js";
import type { AdministrativeDashboardRouteDependencies } from "./administrative-dashboard-route.js";
import type { GetServerHealthCapability } from "../server-health/http/server-health-handler.js";
import type { BackupManagementCapabilities } from "../backup-management/composition/create-backup-management.js";
import type { AdministrativeBackupsRouteDependencies } from "./administrative-backups-route.js";
import type { AdministrativeEventHistoryOperationsRouteDependencies } from "./administrative-event-history-operations-route.js";
import type { AdministrativeSecurityStatusRouteDependencies } from "./administrative-security-status-route.js";
import type { AdministrativeInfrastructureDiagnosticsRouteDependencies } from "./administrative-infrastructure-diagnostics-route.js";
import {
  createInfrastructureDiagnosticsRuntime,
  type InfrastructureDiagnosticsCompositionInput,
} from "../infrastructure-diagnostics/composition/create-infrastructure-diagnostics-runtime.js";
import { NodePm2ProcessListExecutor } from "../service-management/infrastructure/pm2-process-list-executor.js";
import { FileBackupSchedulerCursorStore } from "../backup-management/infrastructure/file-backup-scheduler-state.js";
import { FileMachinePowerSchedulerCursorStore } from "../power-management/infrastructure/file-machine-power-scheduler-cursor-store.js";
import { FileServiceAvailabilityReconciliationSchedulerCursorStore } from "../service-management/infrastructure/file-service-availability-reconciliation-scheduler-cursor-store.js";
import type { AdministrativeIdentityReadiness } from "../access-control/domain/administrative-identity-readiness.js";
import { GetMachinePowerPlan } from "../power-management/application/get-machine-power-plan.js";
import type { MachinePowerPlan } from "../power-management/domain/machine-power-plan.js";
import {
  createMachineOperatingPolicy,
  type MachineOperatingPolicy,
} from "../power-management/domain/machine-operating-policy.js";
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
  readonly schedule?: AdministrativeServiceScheduleRouteDependencies;
  readonly machineSchedule?: AdministrativeMachineScheduleRouteDependencies;
  readonly overview?: AdministrativeOverviewRouteDependencies;
  readonly dashboard?: AdministrativeDashboardRouteDependencies;
  readonly backups?: AdministrativeBackupsRouteDependencies;
  readonly eventHistoryOperations?: AdministrativeEventHistoryOperationsRouteDependencies;
  readonly securityStatus?: AdministrativeSecurityStatusRouteDependencies;
  readonly infrastructureDiagnostics?: AdministrativeInfrastructureDiagnosticsRouteDependencies;
  readonly routeCatalogStatus: Readonly<{ markReconciled(): void }>;
}

export interface AdministrativeRuntimeCompositionDependencies extends ConfiguredPowerManagementRuntimeDependencies {
  readonly eventHistory?: EventHistoryCapabilities;
  readonly powerManagement?: PowerManagementCapabilities;
  readonly machinePlanReader?: Readonly<{
    getMachinePowerPlan: Readonly<{ execute(): MachinePowerPlan }>;
    machineOperatingPolicy: MachineOperatingPolicy;
  }>;
  readonly getServerHealth?: GetServerHealthCapability;
  readonly applicationVersion?: string;
  readonly backupManagement?: BackupManagementCapabilities;
  /**
   * Host adapters for the diagnostics report. Overridden by tests so no test
   * ever spawns a real subprocess or reads real host state (ADR-032 §11).
   */
  readonly infrastructureDiagnosticsHostAdapters?: InfrastructureDiagnosticsCompositionInput["hostAdapters"];
  /** Overridden by tests so no test ever touches the real filesystem. */
  readonly machineOperatingPolicyStore?: MachineOperatingPolicyStore;
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
  const machinePlanReader =
    compositionDependencies.machinePlanReader ??
    (() => {
      const machineOperatingPolicy =
        config.machineOperatingPolicy ??
        createMachineOperatingPolicy({ mode: "always_on" });
      return Object.freeze({
        getMachinePowerPlan: new GetMachinePowerPlan(
          clock,
          machineOperatingPolicy,
        ),
        machineOperatingPolicy,
      });
    })();
  const machineOperatingPolicyStore =
    compositionDependencies.machineOperatingPolicyStore ??
    (config.machineOperatingPolicyFilePath === undefined
      ? undefined
      : new FileMachineOperatingPolicyStore(
          config.machineOperatingPolicyFilePath,
        ));
  const powerSafetyReader = Object.freeze({
    execute: () => {
      const effects = config.machinePowerEffectsActivation?.kind ?? "disabled";
      return Object.freeze({
        backend: config.powerManagementBackend ?? "mock",
        effects,
        machineScheduler: config.machinePowerSchedulerEnabled
          ? "enabled"
          : "disabled",
        helper: effects === "linux_helper" ? "configured" : "unused",
      });
    },
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
    ...(config.administrativeServiceAvailabilityHttpEnabled &&
    config.serviceAvailabilityPolicyFilePath !== undefined
      ? ["ADMINISTRATIVE_SERVICE_SCHEDULE_CAPABILITY"]
      : []),
    ...(config.administrativeWakeAlarmHttpEnabled &&
    config.machineOperatingPolicyFilePath !== undefined
      ? ["ADMINISTRATIVE_MACHINE_SCHEDULE_CAPABILITY"]
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
    ...(config.administrativeInfrastructureDiagnosticsHttpEnabled
      ? ["ADMINISTRATIVE_INFRASTRUCTURE_DIAGNOSTICS_HTTP_ENABLED"]
      : []),
  ];
  const enabledRouteIds = expectedAdministrativeRouteIds(
    enabledActivationFlags,
  );
  const enabledRouteCount = enabledRouteIds.length;
  const activationFlagCount = new Set(
    ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.map(
      (descriptor) => descriptor.activationFlag,
    ),
  ).size;
  const activationFlags = Object.freeze(
    Object.fromEntries(
      [
        ...new Set(
          ADMINISTRATIVE_ROUTE_SECURITY_CATALOG.map(
            (descriptor) => descriptor.activationFlag,
          ),
        ),
      ]
        .sort()
        .map((flag) => [flag, enabledActivationFlags.includes(flag)]),
    ),
  );
  const securityPostureReader = Object.freeze({
    execute: async (): Promise<unknown> => {
      const identityReadiness: AdministrativeIdentityReadiness =
        await cloudflareAuthentication.readIdentityProviderReadiness();
      return Object.freeze({
        identityReadiness,
        routeCatalog: Object.freeze({
          reconciled: routeCatalogReconciled,
          routeCount: enabledRouteCount,
          routeIds: enabledRouteIds,
        }),
        activationFlags,
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
  const infrastructureDiagnostics = createInfrastructureDiagnosticsRuntime({
    clock,
    // Only Atlas's own configured port. There is deliberately no second
    // hardcoded listener (ADR-032 section 8).
    expectedListener: Object.freeze({
      port: config.port,
      binding: config.host === "127.0.0.1" ? "loopback" : "specific",
    } as const),
    ...(compositionDependencies.getServerHealth === undefined
      ? {}
      : { serverHealthReader: compositionDependencies.getServerHealth }),
    pm2ProcessListExecutor: new NodePm2ProcessListExecutor(),
    ...(config.backupSchedulerCursorFilePath === undefined
      ? {}
      : {
          backupSchedulerCursorReader: new FileBackupSchedulerCursorStore(
            config.backupSchedulerCursorFilePath,
          ),
        }),
    ...(config.machinePowerSchedulerCursorFilePath === undefined
      ? {}
      : {
          powerSchedulerCursorReader: new FileMachinePowerSchedulerCursorStore(
            config.machinePowerSchedulerCursorFilePath,
          ),
        }),
    ...(config.serviceAvailabilityReconciliationSchedulerCursorFilePath ===
    undefined
      ? {}
      : {
          serviceAvailabilityReconciliationSchedulerCursorReader:
            new FileServiceAvailabilityReconciliationSchedulerCursorStore(
              config.serviceAvailabilityReconciliationSchedulerCursorFilePath,
            ),
        }),
    eventHistoryReadinessReader:
      eventHistory.checkAdministrativeEventHistoryReadiness,
    powerPostureReader: powerSafetyReader,
    ...(compositionDependencies.infrastructureDiagnosticsHostAdapters ===
    undefined
      ? {}
      : {
          hostAdapters:
            compositionDependencies.infrastructureDiagnosticsHostAdapters,
        }),
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
      machinePlanReader,
      powerSafetyReader,
      ...(machineOperatingPolicyStore === undefined
        ? {}
        : { machineOperatingPolicyStore }),
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
      infrastructureDiagnosticsReader:
        infrastructureDiagnostics.getInfrastructureDiagnostics,
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
    ...((config.administrativeServiceAvailabilityHttpEnabled ?? false) &&
    config.serviceAvailabilityPolicyFilePath !== undefined
      ? {
          schedule: Object.freeze({
            admission,
            mutationGate: serviceMutationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
    ...((config.administrativeWakeAlarmHttpEnabled ?? false) &&
    machineOperatingPolicyStore !== undefined
      ? {
          machineSchedule: Object.freeze({
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
              compositionDependencies.applicationVersion ?? APPLICATION_VERSION,
            administration: Object.freeze({
              wakeAlarmEnabled: config.administrativeWakeAlarmHttpEnabled,
              shutdownEnabled: config.administrativeShutdownHttpEnabled,
            }),
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
    ...(config.administrativeInfrastructureDiagnosticsHttpEnabled === true
      ? {
          infrastructureDiagnostics: Object.freeze({
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
