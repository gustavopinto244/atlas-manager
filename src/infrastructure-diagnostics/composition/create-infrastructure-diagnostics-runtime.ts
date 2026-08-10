import {
  buildInfrastructureDiagnosticReport,
  type DiagnosticClock,
  type ExpectedListener,
  type InfrastructureDiagnosticSources,
} from "../application/build-infrastructure-diagnostic-report.js";
import type { DiagnosticReport } from "../domain/diagnostic-report.js";
import { NodeNginxConfigTestRunner } from "../infrastructure/node-nginx-config-test-runner.js";
import { NodeSystemctlUnitStateReader } from "../infrastructure/node-systemctl-unit-state-reader.js";
import { NodeTcpListenerReader } from "../infrastructure/node-tcp-listener-reader.js";

export interface InfrastructureDiagnosticsCapabilities {
  readonly getInfrastructureDiagnostics: Readonly<{
    execute(): Promise<DiagnosticReport>;
  }>;
}

export interface InfrastructureDiagnosticsCompositionInput {
  readonly clock: DiagnosticClock;
  readonly expectedListener?: ExpectedListener;
  readonly serverHealthReader?: InfrastructureDiagnosticSources["serverHealthReader"];
  readonly pm2ProcessListExecutor?: InfrastructureDiagnosticSources["pm2ProcessListExecutor"];
  readonly backupSchedulerCursorReader?: InfrastructureDiagnosticSources["backupSchedulerCursorReader"];
  readonly powerSchedulerCursorReader?: InfrastructureDiagnosticSources["powerSchedulerCursorReader"];
  readonly eventHistoryReadinessReader?: InfrastructureDiagnosticSources["eventHistoryReadinessReader"];
  readonly powerPostureReader?: InfrastructureDiagnosticSources["powerPostureReader"];
  /**
   * Host adapters are overridable so tests exercise the composition without
   * touching a real host. Production leaves them at the bounded Node defaults.
   */
  readonly hostAdapters?: Readonly<{
    systemdUnitStateReader?: InfrastructureDiagnosticSources["systemdUnitStateReader"];
    tcpListenerReader?: InfrastructureDiagnosticSources["tcpListenerReader"];
    nginxConfigTestRunner?: InfrastructureDiagnosticSources["nginxConfigTestRunner"];
  }>;
}

export function createInfrastructureDiagnosticsRuntime(
  input: InfrastructureDiagnosticsCompositionInput,
): InfrastructureDiagnosticsCapabilities {
  const sources: InfrastructureDiagnosticSources = Object.freeze({
    clock: input.clock,
    systemdUnitStateReader:
      input.hostAdapters?.systemdUnitStateReader ??
      new NodeSystemctlUnitStateReader(),
    tcpListenerReader:
      input.hostAdapters?.tcpListenerReader ?? new NodeTcpListenerReader(),
    nginxConfigTestRunner:
      input.hostAdapters?.nginxConfigTestRunner ??
      new NodeNginxConfigTestRunner(),
    ...(input.expectedListener === undefined
      ? {}
      : { expectedListener: input.expectedListener }),
    ...(input.serverHealthReader === undefined
      ? {}
      : { serverHealthReader: input.serverHealthReader }),
    ...(input.pm2ProcessListExecutor === undefined
      ? {}
      : { pm2ProcessListExecutor: input.pm2ProcessListExecutor }),
    ...(input.backupSchedulerCursorReader === undefined
      ? {}
      : { backupSchedulerCursorReader: input.backupSchedulerCursorReader }),
    ...(input.powerSchedulerCursorReader === undefined
      ? {}
      : { powerSchedulerCursorReader: input.powerSchedulerCursorReader }),
    ...(input.eventHistoryReadinessReader === undefined
      ? {}
      : { eventHistoryReadinessReader: input.eventHistoryReadinessReader }),
    ...(input.powerPostureReader === undefined
      ? {}
      : { powerPostureReader: input.powerPostureReader }),
  });
  return Object.freeze({
    getInfrastructureDiagnostics: Object.freeze({
      // A fresh `nginx -t` runs on every fetch. This is affordable because the
      // Infrastructure page is not in the dashboard's 30s auto-poll set, so the
      // probe only fires on a human-triggered CLI call or manual refresh.
      execute: () => buildInfrastructureDiagnosticReport(sources),
    }),
  });
}
