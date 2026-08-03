import { describe, expect, it } from "vitest";
import {
  administrativeAuthorityMatches,
  parseAdministrativePublicOrigin,
} from "../../src/http/administrative-public-origin.js";

describe("administrative public origin", () => {
  it("accepts only canonical HTTPS origins", () => {
    const origin = parseAdministrativePublicOrigin("https://atlas.example.com");
    expect(origin.origin).toBe("https://atlas.example.com");
    expect(administrativeAuthorityMatches("atlas.example.com", origin)).toBe(
      true,
    );
  });

  it.each([
    "evil.example@atlas.example.com",
    "atlas.example.com/extra",
    "atlas.example.com?x=1",
    "atlas.example.com#fragment",
    "atlas.example.com:443",
    " atlas.example.com",
    "atlas.example.com,evil.example",
    "atlas.example.com\nX-Injected: value",
  ])("rejects non-authority host syntax: %s", (host) => {
    const origin = parseAdministrativePublicOrigin("https://atlas.example.com");
    expect(administrativeAuthorityMatches(host, origin)).toBe(false);
  });

  it.each([
    "http://atlas.example.com",
    "https://user:pass@atlas.example.com",
    "https://atlas.example.com/admin",
    "https://*.example.com",
    "https://127.0.0.1",
  ])("rejects unsafe origin %s", (value) => {
    expect(() => parseAdministrativePublicOrigin(value)).toThrow(
      "administrative_public_origin_invalid",
    );
  });
});
