const CONTROL_OPERATIONS = Object.freeze(["start", "stop", "restart"] as const);

export type ServiceControlOperation = (typeof CONTROL_OPERATIONS)[number];

// Registered services declare their supported operations explicitly (see
// RegisteredService.supportedOperations). Rendering a control the backend
// would reject as unsupported misleads the operator, so the dashboard must
// derive its buttons from this field instead of a fixed list.
export function controlOperationsFor(
  service: Record<string, unknown>,
): readonly ServiceControlOperation[] {
  const supported = readSupportedOperations(service);
  return CONTROL_OPERATIONS.filter((operation) =>
    supported.includes(operation),
  );
}

export function supportsLogs(service: Record<string, unknown>): boolean {
  return readSupportedOperations(service).includes("readLogs");
}

function readSupportedOperations(
  service: Record<string, unknown>,
): readonly string[] {
  const value = service["supportedOperations"];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

const STATUS_CHIP_MODIFIER: Readonly<Record<string, string>> = Object.freeze({
  running: "online",
  stopped: "offline",
  failed: "unavailable",
  unknown: "degraded",
});

// Registered-service runtime states (SERVICE_RUNTIME_STATES) are backend
// authoritative and closed; an unrecognized value is treated as "degraded"
// rather than silently defaulting to an online-looking chip.
export function statusChipModifier(status: unknown): string {
  return typeof status === "string" && status in STATUS_CHIP_MODIFIER
    ? STATUS_CHIP_MODIFIER[status]!
    : "degraded";
}
