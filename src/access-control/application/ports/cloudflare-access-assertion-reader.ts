import type { CloudflareAccessJwtAssertion } from "../../domain/cloudflare-access-jwt-assertion.js";

export type CloudflareAccessAssertionReadResult =
  | Readonly<{ outcome: "absent" }>
  | Readonly<{
      outcome: "present";
      assertion: CloudflareAccessJwtAssertion;
    }>
  | Readonly<{ outcome: "invalid" }>;

export interface CloudflareAccessAssertionReader {
  read(): CloudflareAccessAssertionReadResult;
}
