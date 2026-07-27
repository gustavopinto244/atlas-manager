import { describe, expect, it } from "vitest";

import {
  validateDockerComposeManagementConfiguration,
  ManagementConfigurationValidationError,
} from "../../../src/service-management/domain/management-configuration.js";

describe("validateDockerComposeManagementConfiguration", () => {
  it("validates a complete Compose configuration", () => {
    const result = validateDockerComposeManagementConfiguration({
      composeFile: "/srv/atlas/compose.yaml",
      projectDirectory: "/srv/atlas",
    });

    expect(result.composeFile).toBe("/srv/atlas/compose.yaml");
    expect(result.projectDirectory).toBe("/srv/atlas");
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("trims whitespace from paths", () => {
    const result = validateDockerComposeManagementConfiguration({
      composeFile: "  /srv/atlas/compose.yaml  ",
      projectDirectory: "  /srv/atlas  ",
    });

    expect(result.composeFile).toBe("/srv/atlas/compose.yaml");
    expect(result.projectDirectory).toBe("/srv/atlas");
  });

  it("rejects missing composeFile", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "",
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(ManagementConfigurationValidationError);
  });

  it("rejects missing projectDirectory", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/srv/atlas/compose.yaml",
        projectDirectory: "",
      }),
    ).toThrowError(ManagementConfigurationValidationError);
  });

  it("rejects relative paths", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "compose.yaml",
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(ManagementConfigurationValidationError);
  });

  it("rejects compose file escaping project directory", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/etc/compose.yaml",
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(expect.objectContaining({ code: "path_escape" }));
  });

  it("rejects paths with .. traversal", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/srv/atlas/../etc/compose.yaml",
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(expect.objectContaining({ code: "path_escape" }));
  });

  it("rejects unknown fields", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/srv/atlas/compose.yaml",
        projectDirectory: "/srv/atlas",
        extraField: "value",
      } as Record<string, unknown>),
    ).toThrowError(expect.objectContaining({ code: "unknown_field" }));
  });

  it("rejects control characters in compose file", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/srv/atlas/\x00compose.yaml",
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(ManagementConfigurationValidationError);
  });

  it("rejects control characters in project directory", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/srv/atlas/compose.yaml",
        projectDirectory: "/srv/atlas/\x00extra",
      }),
    ).toThrowError(ManagementConfigurationValidationError);
  });

  it("rejects excessively long paths", () => {
    const longPath = "/" + "a".repeat(5000);
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: longPath,
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(ManagementConfigurationValidationError);
  });

  it("accepts nested compose files within the project directory", () => {
    const result = validateDockerComposeManagementConfiguration({
      composeFile: "/srv/atlas/subdir/compose.yaml",
      projectDirectory: "/srv/atlas",
    });

    expect(result.composeFile).toBe("/srv/atlas/subdir/compose.yaml");
  });

  it("rejects root-only compose file path", () => {
    expect(() =>
      validateDockerComposeManagementConfiguration({
        composeFile: "/",
        projectDirectory: "/srv/atlas",
      }),
    ).toThrowError(expect.objectContaining({ code: "path_escape" }));
  });
});
