import type { EnvironmentConfig } from "../config/environment.js";
import { createAdministrativeAccessControl } from "../access-control/composition/create-administrative-access-control.js";
import { createCloudflareAccessAdministrativeAuthentication } from "../access-control/composition/create-cloudflare-access-administrative-authentication.js";
import { createProtectedAdministration } from "../access-control/composition/create-protected-administration.js";
import { InMemoryAdministrativeRoleAssignmentReader } from "../access-control/infrastructure/in-memory-administrative-role-assignment-reader.js";
import { createEventHistory } from "../event-history/composition/create-event-history.js";
import { createPowerManagement } from "../power-management/composition/create-power-management.js";
import type { AdministrativeEventHistoryPage } from "../event-history/domain/administrative-event-history-page.js";
import {
  FixedAdministrativeRequestAdmission,
  type AdministrativeRequestClock,
} from "./administrative-request-admission.js";
import { FixedAdministrativeWakeAlarmMutationGate } from "./administrative-wake-alarm-mutation-gate.js";
import type { AdministrativeEventHistoryRouteDependencies } from "./administrative-event-history-route.js";
import type { AdministrativeWakeAlarmRouteDependencies } from "./administrative-wake-alarm-route.js";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";

export interface AdministrativeRuntime {
  readonly eventHistory?: AdministrativeEventHistoryRouteDependencies;
  readonly wakeAlarm?: AdministrativeWakeAlarmRouteDependencies;
}

export function createAdministrativeRuntime(
  config: EnvironmentConfig,
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
  const eventHistory = createEventHistory({ filePath });
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
  const powerManagement = createPowerManagement({
    clock,
    administrativeEventHistoryCapabilities: eventHistory,
  });
  const admission = new FixedAdministrativeRequestAdmission(clock);
  const mutationGate = new FixedAdministrativeWakeAlarmMutationGate();

  const createProtected = (reader: CloudflareAccessAssertionReader) => {
    const accessControl = createAdministrativeAccessControl({
      authenticator:
        cloudflareAuthentication.createAuthenticationProviderForRequest(reader),
      roleAssignmentReader,
    });
    return createProtectedAdministration({
      accessControl,
      powerManagement,
      eventHistory,
      clock,
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
            mutationGate,
            createProtectedAdministration: (
              reader: CloudflareAccessAssertionReader,
            ) => createProtected(reader),
          }),
        }
      : {}),
  });
}
