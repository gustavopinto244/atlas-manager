import { describe, expect, it, vi } from "vitest";
import {
  LINUX_POWER_HELPER_PATH,
  LinuxPowerHelperInstallationError,
  NodeLinuxPowerHelperInstallationInspector,
  type LinuxPowerHelperFileStats,
} from "../../../src/power-management/infrastructure/linux-power-helper-installation-inspector.js";

const validFile: LinuxPowerHelperFileStats = {
  isSymbolicLink: false,
  isRegularFile: true,
  isDirectory: false,
  uid: 0,
  mode: 0o755,
};
const validParent: LinuxPowerHelperFileStats = {
  isSymbolicLink: false,
  isRegularFile: false,
  isDirectory: true,
  uid: 0,
  mode: 0o755,
};

function createFileSystem(
  file: LinuxPowerHelperFileStats = validFile,
  parent: LinuxPowerHelperFileStats = validParent,
) {
  return {
    lstat: vi.fn((path: string) => {
      if (path === LINUX_POWER_HELPER_PATH) return file;
      return parent;
    }),
  };
}

describe("Linux power-helper installation inspection", () => {
  it("accepts a root-owned regular executable and checks the fixed paths", () => {
    const fileSystem = createFileSystem();
    new NodeLinuxPowerHelperInstallationInspector(fileSystem).inspect();
    expect(fileSystem.lstat).toHaveBeenNthCalledWith(
      1,
      LINUX_POWER_HELPER_PATH,
    );
    expect(fileSystem.lstat).toHaveBeenNthCalledWith(2, "/usr/local/libexec");
  });

  it.each([
    ["helper_symbolic_link_rejected", { ...validFile, isSymbolicLink: true }],
    ["helper_not_regular_file", { ...validFile, isRegularFile: false }],
    ["helper_owner_invalid", { ...validFile, uid: 1000 }],
    ["helper_permissions_unsafe", { ...validFile, mode: 0o775 }],
    ["helper_not_executable", { ...validFile, mode: 0o644 }],
  ] as const)("rejects unsafe helper files with %s", (code, file) => {
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(
        createFileSystem(file),
      ).inspect(),
    ).toThrowError(new LinuxPowerHelperInstallationError(code));
  });

  it.each([
    ["helper_parent_invalid", { ...validParent, isSymbolicLink: true }],
    ["helper_parent_invalid", { ...validParent, isDirectory: false }],
    ["helper_parent_invalid", { ...validParent, mode: 0o775 }],
  ] as const)("rejects unsafe parent directories with %s", (code, parent) => {
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(
        createFileSystem(validFile, parent),
      ).inspect(),
    ).toThrowError(new LinuxPowerHelperInstallationError(code));
  });

  it("translates missing and unexpected inspection failures without exposing details", () => {
    const missing = {
      lstat: vi.fn(() => {
        const error = new Error("private path");
        Object.assign(error, { code: "ENOENT" });
        throw error;
      }),
    };
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(missing).inspect(),
    ).toThrowError("helper_not_found");

    const failed = {
      lstat: vi.fn(() => {
        throw new Error("private filesystem detail");
      }),
    };
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(failed).inspect(),
    ).toThrowError("helper_inspection_failed");
  });
});
