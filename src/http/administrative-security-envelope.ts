import type { NextFunction, Request, Response } from "express";
import { HttpError } from "./errors/http-error.js";
import {
  administrativeAuthorityMatches,
  type AdministrativePublicOrigin,
} from "./administrative-public-origin.js";
import { setAdministrativeSecurityHeaders } from "./administrative-http.js";

export function createAdministrativeSecurityEnvelope(input: {
  publicOrigin: AdministrativePublicOrigin;
}) {
  return (request: Request, response: Response, next: NextFunction): void => {
    setAdministrativeSecurityHeaders(response);
    try {
      const hostHeaders = request.rawHeaders.filter(
        (_value, index, values) =>
          index % 2 === 1 && values[index - 1]?.toLowerCase() === "host",
      );
      if (
        hostHeaders.length !== 1 ||
        !administrativeAuthorityMatches(hostHeaders[0], input.publicOrigin)
      )
        throw new HttpError(
          400,
          "administrative_host_rejected",
          "Administrative request rejected",
        );
      validateOrigin(request.headers.origin, input.publicOrigin.origin);
      validateFetchMetadata(request);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function validateOrigin(value: string | undefined, expected: string): void {
  if (value === undefined) return;
  if (value !== expected)
    throw new HttpError(
      403,
      "administrative_origin_rejected",
      "Administrative request rejected",
    );
}

function validateFetchMetadata(request: Request): void {
  const site = request.headers["sec-fetch-site"];
  const mode = request.headers["sec-fetch-mode"];
  const destination = request.headers["sec-fetch-dest"];
  for (const value of [site, mode, destination]) {
    if (
      Array.isArray(value) ||
      (value !== undefined && !/^[a-z-]+$/u.test(value))
    )
      throw new HttpError(
        403,
        "administrative_browser_context_rejected",
        "Administrative request rejected",
      );
  }
  if (
    site !== undefined &&
    site !== "same-origin" &&
    site !== "same-site" &&
    site !== "none"
  )
    throw new HttpError(
      403,
      "administrative_browser_context_rejected",
      "Administrative request rejected",
    );
  if (
    mode !== undefined &&
    !["navigate", "same-origin", "cors", "no-cors"].includes(mode)
  )
    throw new HttpError(
      403,
      "administrative_browser_context_rejected",
      "Administrative request rejected",
    );
  if (
    destination !== undefined &&
    ![
      "",
      "document",
      "empty",
      "embed",
      "font",
      "image",
      "manifest",
      "media",
      "object",
      "report",
      "script",
      "serviceworker",
      "sharedworker",
      "style",
      "worker",
      "xslt",
    ].includes(destination)
  )
    throw new HttpError(
      403,
      "administrative_browser_context_rejected",
      "Administrative request rejected",
    );
  if (mode === "navigate" && destination !== "document")
    throw new HttpError(
      403,
      "administrative_browser_context_rejected",
      "Administrative request rejected",
    );
  if (
    (mode === "cors" || mode === "same-origin") &&
    destination !== undefined &&
    destination !== "" &&
    destination !== "empty"
  )
    throw new HttpError(
      403,
      "administrative_browser_context_rejected",
      "Administrative request rejected",
    );
}
