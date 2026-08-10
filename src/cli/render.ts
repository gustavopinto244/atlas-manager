/**
 * Human output rendering.
 *
 * Human output is deliberately *not* a machine contract: it may change between
 * releases, and nothing inside the CLI parses it. Machine consumers use
 * `--json`, whose envelope is versioned in `contracts.ts`.
 */

const SERVICE_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "services start",
  "services stop",
  "services restart",
]);

const SERVICE_SCHEDULE_MUTATION_COMMANDS: ReadonlySet<string> = new Set([
  "services schedule set",
  "services schedule always",
  "services schedule manual",
  "services schedule disable",
  "services schedule remove",
]);

export function renderHumanResult(command: string, data: unknown): string {
  if (SERVICE_MUTATION_COMMANDS.has(command)) {
    const rendered = renderServiceMutation(data);
    if (rendered !== undefined) return rendered;
  }
  if (SERVICE_SCHEDULE_MUTATION_COMMANDS.has(command)) {
    const rendered = renderScheduleMutation(data);
    if (rendered !== undefined) return rendered;
  }
  if (command === "backups run") {
    const rendered = renderBackupRun(data);
    if (rendered !== undefined) return rendered;
  }
  if (command === "backups retention prune") {
    const rendered = renderRetentionPrune(data);
    if (rendered !== undefined) return rendered;
  }
  return `${JSON.stringify(data, null, 2)}\n`;
}

function renderRetentionPrune(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (
    typeof record.targetId !== "string" ||
    typeof record.result !== "string" ||
    typeof record.processedCount !== "number" ||
    typeof record.deletedCount !== "number"
  )
    return undefined;
  return `${[
    `Backup target: ${record.targetId}`,
    `Retention prune: ${record.result}`,
    `Processed: ${record.processedCount}`,
    `Deleted: ${record.deletedCount}`,
  ].join("\n")}\n`;
}

function renderBackupRun(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (
    typeof record.targetId !== "string" ||
    typeof record.runId !== "string" ||
    typeof record.status !== "string"
  )
    return undefined;
  const lines = [
    `Backup target: ${record.targetId}`,
    `Run: ${record.runId}`,
    // The server's own terminal status, never a rephrasing of it.
    `Status: ${record.status}`,
  ];
  if (typeof record.fileCount === "number")
    lines.push(`Files: ${record.fileCount}`);
  if (typeof record.totalBytes === "number")
    lines.push(`Bytes: ${record.totalBytes}`);
  return `${lines.join("\n")}\n`;
}

function renderScheduleMutation(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (
    typeof record.serviceId !== "string" ||
    typeof record.operation !== "string" ||
    typeof record.result !== "string" ||
    typeof record.mode !== "string"
  )
    return undefined;
  const lines = [
    `Service: ${record.serviceId}`,
    `Schedule: ${record.operation === "delete" ? "removed" : "updated"}`,
    `Result: ${record.result}`,
    `Effective mode: ${record.mode}`,
  ];
  if (record.operation === "delete")
    lines.push(
      "Note: the stored override was removed; the service now follows its configured default policy.",
    );
  if (record.authoritativeRead === "unavailable")
    lines.push(
      "Note: the mutation was accepted but the stored schedule could not be re-read.",
    );
  return `${lines.join("\n")}\n`;
}

function renderServiceMutation(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (
    typeof record.serviceId !== "string" ||
    typeof record.operation !== "string" ||
    typeof record.result !== "string" ||
    typeof record.state !== "string"
  )
    return undefined;
  const lines = [
    `Service: ${typeof record.displayName === "string" ? record.displayName : record.serviceId}`,
    `Operation: ${record.operation}`,
    `Result: ${record.result}`,
    `State: ${record.state}`,
  ];
  if (record.authoritativeRead === "unavailable")
    lines.push(
      "Note: the operation was accepted but its authoritative state could not be re-read.",
    );
  return `${lines.join("\n")}\n`;
}
