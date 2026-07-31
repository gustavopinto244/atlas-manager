import {
  createAdministrativeEvent,
  type AdministrativeEvent,
} from "./administrative-event.js";

export interface AdministrativeEventHistoryPage {
  readonly events: readonly AdministrativeEvent[];
  readonly hasMore: boolean;
  readonly nextAfterSequence?: number;
}

export class AdministrativeEventHistoryPageValidationError extends Error {
  public override readonly name =
    "AdministrativeEventHistoryPageValidationError";
  public constructor(
    public readonly code:
      | "invalid_record"
      | "invalid_field"
      | "invalid_events"
      | "invalid_has_more",
  ) {
    super(`Invalid administrative event-history page: ${code}`);
    Object.freeze(this);
  }
}

export function createAdministrativeEventHistoryPage(
  input: unknown,
): AdministrativeEventHistoryPage {
  if (!isRecord(input))
    throw new AdministrativeEventHistoryPageValidationError("invalid_record");
  const keys = Reflect.ownKeys(input);
  if (
    keys.some(
      (key) => typeof key !== "string" || !["events", "hasMore"].includes(key),
    )
  )
    throw new AdministrativeEventHistoryPageValidationError("invalid_field");
  if (!Array.isArray(input["events"]))
    throw new AdministrativeEventHistoryPageValidationError("invalid_events");
  if (typeof input["hasMore"] !== "boolean")
    throw new AdministrativeEventHistoryPageValidationError("invalid_has_more");
  let events: readonly AdministrativeEvent[];
  try {
    events = Object.freeze(
      input["events"].map((event) => createAdministrativeEvent(event)),
    );
  } catch {
    throw new AdministrativeEventHistoryPageValidationError("invalid_events");
  }
  return Object.freeze({
    events,
    hasMore: input["hasMore"],
    ...(events.length > 0
      ? { nextAfterSequence: events[events.length - 1]!.sequence }
      : {}),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
