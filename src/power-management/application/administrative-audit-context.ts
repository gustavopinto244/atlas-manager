import type {
  AdministrativeEventSource,
  AdministrativeEventTarget,
} from "../../event-history/domain/administrative-event.js";

export const DIRECT_POWER_AUDIT_SOURCE: AdministrativeEventSource =
  Object.freeze({
    kind: "administrative",
    actorId: "unattributed-local",
  });
export const SCHEDULER_POWER_AUDIT_SOURCE: AdministrativeEventSource =
  Object.freeze({
    kind: "automated",
    actorId: "machine-power-scheduler",
  });
export const MACHINE_AUDIT_TARGET: AdministrativeEventTarget = Object.freeze({
  kind: "machine",
  id: "atlas",
});
