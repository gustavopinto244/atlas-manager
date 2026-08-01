import type { Request } from "express";
import type { CloudflareAccessAssertionReader } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";
import type { CloudflareAccessAssertionReadResult } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";

export const CLOUDFLARE_ACCESS_ASSERTION_HEADER = "cf-access-jwt-assertion";
import { createCloudflareAccessJwtAssertion } from "../access-control/domain/cloudflare-access-jwt-assertion.js";

export type { CloudflareAccessJwtAssertion } from "../access-control/domain/cloudflare-access-jwt-assertion.js";

export type { CloudflareAccessAssertionReadResult } from "../access-control/application/ports/cloudflare-access-assertion-reader.js";

export function createCloudflareAccessAssertionReader(
  request: Pick<Request, "headers">,
): CloudflareAccessAssertionReader {
  return createCloudflareAccessAssertionReaderFromHeaders(request.headers);
}

export function createCloudflareAccessAssertionReaderFromHeaders(
  headers: Readonly<Record<string, unknown>>,
): CloudflareAccessAssertionReader {
  const result = readAssertionHeader(headers);
  return Object.freeze({
    read: () => result,
  });
}

export { createCloudflareAccessJwtAssertion } from "../access-control/domain/cloudflare-access-jwt-assertion.js";

function readAssertionHeader(
  headers: Readonly<Record<string, unknown>>,
): CloudflareAccessAssertionReadResult {
  const matches = Reflect.ownKeys(headers).filter(
    (key) =>
      typeof key === "string" &&
      key.toLowerCase() === CLOUDFLARE_ACCESS_ASSERTION_HEADER,
  );
  if (matches.length === 0) return Object.freeze({ outcome: "absent" });
  if (matches.length !== 1) return Object.freeze({ outcome: "invalid" });
  const value = headers[matches[0] as string];
  if (typeof value !== "string") return Object.freeze({ outcome: "invalid" });
  try {
    return Object.freeze({
      outcome: "present" as const,
      assertion: createCloudflareAccessJwtAssertion(value),
    });
  } catch {
    return Object.freeze({ outcome: "invalid" as const });
  }
}
