export interface ServiceLogBatch {
  readonly serviceId: string;
  readonly collectedAt: string;
  readonly stdoutLines: readonly string[];
  readonly stderrLines: readonly string[];
  readonly truncated: boolean;
}

export function createServiceLogBatch(params: {
  serviceId: string;
  collectedAt: string;
  stdoutLines: readonly string[];
  stderrLines: readonly string[];
  truncated: boolean;
}): ServiceLogBatch {
  if (!params.serviceId || params.serviceId.trim() === "") {
    throw new Error("serviceId is required");
  }

  if (!params.collectedAt || params.collectedAt.trim() === "") {
    throw new Error("collectedAt is required");
  }

  const canonicalDate = new Date(params.collectedAt);
  if (Number.isNaN(canonicalDate.getTime())) {
    throw new Error("collectedAt must be a canonical UTC timestamp");
  }

  for (const line of params.stdoutLines) {
    if (typeof line !== "string") {
      throw new Error("stdoutLines must contain only strings");
    }
  }

  for (const line of params.stderrLines) {
    if (typeof line !== "string") {
      throw new Error("stderrLines must contain only strings");
    }
  }

  return Object.freeze({
    serviceId: params.serviceId,
    collectedAt: canonicalDate.toISOString(),
    stdoutLines: Object.freeze([...params.stdoutLines]),
    stderrLines: Object.freeze([...params.stderrLines]),
    truncated: params.truncated,
  });
}
