import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import {
  APPLICATION_VERSION,
  ApplicationVersionError,
  readApplicationVersion,
} from "../../src/config/application-version.js";

const packageVersion = (
  createRequire(import.meta.url)("../../package.json") as Readonly<{
    version: string;
  }>
).version;

describe("application version", () => {
  it("matches the packaged version rather than a duplicated literal", () => {
    expect(APPLICATION_VERSION).toBe(packageVersion);
  });

  it("accepts release and prerelease versions", () => {
    for (const value of ["1.0.0", "1.0.0-rc.11", "10.20.30-alpha.1"])
      expect(readApplicationVersion(value)).toBe(value);
  });

  it("rejects anything that is not a version string", () => {
    for (const value of [
      "",
      "v1.0.0",
      "1.0",
      "1.0.0.0",
      " 1.0.0",
      undefined,
      null,
      1,
    ])
      expect(() => readApplicationVersion(value)).toThrow(
        ApplicationVersionError,
      );
  });

  it("carries no stale release candidate literal", () => {
    expect(APPLICATION_VERSION).not.toBe("1.0.0-rc.8");
  });
});
