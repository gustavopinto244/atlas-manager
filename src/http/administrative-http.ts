import type { Request, Response } from "express";

import { AdministrativeAccessControlError } from "../access-control/application/errors.js";
import { HttpError } from "./errors/http-error.js";

export const ADMINISTRATIVE_MAX_REQUEST_TARGET_BYTES = 4_096;

export function setAdministrativeSecurityHeaders(response: Response): void {
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Pragma", "no-cache");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
}

export function validateAdministrativeRequestTarget(
  requestTarget: string,
): void {
  if (
    Buffer.byteLength(requestTarget, "utf8") >
    ADMINISTRATIVE_MAX_REQUEST_TARGET_BYTES
  )
    throw new HttpError(414, "uri_too_long", "URI Too Long");
}

export function validateAdministrativeRequestHasNoBody(
  request: Pick<Request, "headers">,
): void {
  const contentLength = request.headers["content-length"];
  const transferEncoding = request.headers["transfer-encoding"];
  const contentType = request.headers["content-type"];
  if (
    transferEncoding !== undefined ||
    Array.isArray(contentLength) ||
    (contentLength !== undefined && contentLength !== "0") ||
    contentType !== undefined
  )
    throw new HttpError(
      400,
      "invalid_administrative_request",
      "Invalid administrative request",
    );
}

export function rejectAdministrativeQuery(requestTarget: string): void {
  if (requestTarget.includes("?"))
    throw new HttpError(
      400,
      "invalid_administrative_request",
      "Invalid administrative request",
    );
}

export function mapAdministrativeAccessControlError(
  error: unknown,
): HttpError | undefined {
  if (!(error instanceof AdministrativeAccessControlError)) return undefined;
  if (error.code === "administrative_authentication_required")
    return new HttpError(
      401,
      "administrative_authentication_required",
      "Administrative authentication required",
    );
  if (error.code === "administrative_authorization_denied")
    return new HttpError(
      403,
      "administrative_authorization_denied",
      "Administrative authorization denied",
    );
  if (error.code === "administrative_identity_unavailable")
    return new HttpError(
      503,
      "administrative_identity_unavailable",
      "Administrative identity unavailable",
    );
  if (error.code === "authorization_audit_unavailable")
    return new HttpError(
      503,
      "authorization_audit_unavailable",
      "Authorization audit unavailable",
    );
  return new HttpError(
    503,
    "administrative_authorization_unavailable",
    "Administrative authorization unavailable",
  );
}
