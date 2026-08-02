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
  gid: 2000,
  mode: 0o4750,
  nlink: 1,
};
const validParent: LinuxPowerHelperFileStats = {
  isSymbolicLink: false,
  isRegularFile: false,
  isDirectory: true,
  uid: 0,
  gid: 0,
  mode: 0o755,
  nlink: 1,
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
    getProcessGroups: vi.fn(() => [2000]),
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
    expect(fileSystem.lstat).toHaveBeenNthCalledWith(2, "/usr");
    expect(fileSystem.lstat).toHaveBeenNthCalledWith(3, "/usr/local");
    expect(fileSystem.lstat).toHaveBeenNthCalledWith(4, "/usr/local/libexec");
  });

  it("requires the admitted helper-group GID when one is supplied", () => {
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(createFileSystem()).inspect(
        3000,
      ),
    ).toThrowError(
      new LinuxPowerHelperInstallationError("helper_group_invalid"),
    );
  });

  it.each([
    ["helper_symbolic_link_rejected", { ...validFile, isSymbolicLink: true }],
    ["helper_not_regular_file", { ...validFile, isRegularFile: false }],
    ["helper_owner_invalid", { ...validFile, uid: 1000 }],
    ["helper_setuid_required", { ...validFile, mode: 0o750 }],
    ["helper_group_invalid", { ...validFile, gid: 0 }],
    ["helper_mode_invalid", { ...validFile, mode: 0o4755 }],
    ["helper_process_group_missing", { ...validFile, gid: 3000 }],
    ["helper_link_count_invalid", { ...validFile, nlink: 2 }],
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
    ["helper_parent_owner_invalid", { ...validParent, uid: 1000 }],
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
      getProcessGroups: vi.fn(() => []),
    };
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(missing).inspect(),
    ).toThrowError("helper_not_found");

    const failed = {
      lstat: vi.fn(() => {
        throw new Error("private filesystem detail");
      }),
      getProcessGroups: vi.fn(() => []),
    };
    expect(() =>
      new NodeLinuxPowerHelperInstallationInspector(failed).inspect(),
    ).toThrowError("helper_inspection_failed");
  });
});
