import {
  createAdministrativeEventHistoryQuery,
  type AdministrativeEventHistoryQuery,
} from "../event-history/domain/administrative-event-history-query.js";

const QUERY_KEYS = new Set([
  "afterSequence",
  "limit",
  "source",
  "operation",
  "status",
  "attemptId",
  "occurredFrom",
  "occurredTo",
]);
const UNSIGNED_DECIMAL = /^(?:0|[1-9][0-9]*)$/u;

export class AdministrativeEventHistoryQueryParseError extends Error {
  public override readonly name = "AdministrativeEventHistoryQueryParseError";
  public constructor() {
    super("Invalid administrative event-history query");
    Object.freeze(this);
  }
}

export function parseAdministrativeEventHistoryQuery(
  requestTarget: string,
): AdministrativeEventHistoryQuery {
  const questionMark = requestTarget.indexOf("?");
  if (questionMark < 0) return createAdministrativeEventHistoryQuery();
  const rawQuery = requestTarget.slice(questionMark + 1);
  if (rawQuery.length === 0) return createAdministrativeEventHistoryQuery();
  const pairs = rawQuery.split("&");
  if (pairs.length > 8 || pairs.some((pair) => pair.length === 0))
    throw new AdministrativeEventHistoryQueryParseError();

  const values: Record<string, string> = {};
  const seen = new Set<string>();
  for (const pair of pairs) {
    const equals = pair.indexOf("=");
    if (equals <= 0) throw new AdministrativeEventHistoryQueryParseError();
    const key = decode(pair.slice(0, equals));
    const value = decode(pair.slice(equals + 1));
    if (
      !QUERY_KEYS.has(key) ||
      seen.has(key) ||
      value.length === 0 ||
      key.trim() !== key ||
      value.trim() !== value ||
      hasControlCharacter(key) ||
      hasControlCharacter(value)
    )
      throw new AdministrativeEventHistoryQueryParseError();
    seen.add(key);
    values[key] = value;
  }

  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === "afterSequence" || key === "limit") {
      if (!UNSIGNED_DECIMAL.test(value))
        throw new AdministrativeEventHistoryQueryParseError();
      const number = Number(value);
      if (!Number.isSafeInteger(number))
        throw new AdministrativeEventHistoryQueryParseError();
      input[key] = number;
    } else {
      input[key] = value;
    }
  }
  try {
    return createAdministrativeEventHistoryQuery(input);
  } catch {
    throw new AdministrativeEventHistoryQueryParseError();
  }
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new AdministrativeEventHistoryQueryParseError();
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}
