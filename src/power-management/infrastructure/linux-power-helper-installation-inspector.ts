import { lstatSync } from "node:fs";

export const LINUX_POWER_HELPER_PATH =
  "/usr/local/libexec/atlas-manager-power-helper" as const;

export type LinuxPowerHelperInstallationErrorCode =
  | "helper_not_found"
  | "helper_not_regular_file"
  | "helper_symbolic_link_rejected"
  | "helper_owner_invalid"
  | "helper_setuid_required"
  | "helper_group_invalid"
  | "helper_process_group_missing"
  | "helper_mode_invalid"
  | "helper_link_count_invalid"
  | "helper_permissions_unsafe"
  | "helper_not_executable"
  | "helper_parent_invalid"
  | "helper_parent_owner_invalid"
  | "helper_inspection_failed";

export class LinuxPowerHelperInstallationError extends Error {
  public override readonly name = "LinuxPowerHelperInstallationError";

  public constructor(
    public readonly code: LinuxPowerHelperInstallationErrorCode,
  ) {
    super(`Linux power-helper installation is invalid: ${code}`);
    Object.freeze(this);
  }
}

export interface LinuxPowerHelperInstallationInspector {
  inspect(expectedHelperGroupId?: number): void;
}

export interface LinuxPowerHelperFileStats {
  readonly isSymbolicLink: boolean;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
  readonly uid: number;
  readonly gid: number;
  readonly mode: number;
  readonly nlink: number;
}

export interface LinuxPowerHelperFileSystem {
  lstat(path: string): LinuxPowerHelperFileStats;
  getProcessGroups(): readonly number[];
}

export class NodeLinuxPowerHelperInstallationInspector implements LinuxPowerHelperInstallationInspector {
  readonly #fileSystem: LinuxPowerHelperFileSystem;

  public constructor(fileSystem: LinuxPowerHelperFileSystem = nodeFileSystem) {
    this.#fileSystem = fileSystem;
    Object.freeze(this);
  }

  public inspect(expectedHelperGroupId?: number): void {
    let helper: LinuxPowerHelperFileStats;
    try {
      helper = this.#fileSystem.lstat(LINUX_POWER_HELPER_PATH);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new LinuxPowerHelperInstallationError("helper_not_found");
      }
      throw new LinuxPowerHelperInstallationError("helper_inspection_failed");
    }

    if (helper.isSymbolicLink) {
      throw new LinuxPowerHelperInstallationError(
        "helper_symbolic_link_rejected",
      );
    }
    if (!helper.isRegularFile) {
      throw new LinuxPowerHelperInstallationError("helper_not_regular_file");
    }
    if (helper.uid !== 0) {
      throw new LinuxPowerHelperInstallationError("helper_owner_invalid");
    }
    if ((helper.mode & 0o4000) === 0) {
      throw new LinuxPowerHelperInstallationError("helper_setuid_required");
    }
    if (helper.gid <= 0) {
      throw new LinuxPowerHelperInstallationError("helper_group_invalid");
    }
    if (
      expectedHelperGroupId !== undefined &&
      helper.gid !== expectedHelperGroupId
    ) {
      throw new LinuxPowerHelperInstallationError("helper_group_invalid");
    }
    if ((helper.mode & 0o7777) !== 0o4750) {
      throw new LinuxPowerHelperInstallationError("helper_mode_invalid");
    }
    if (helper.nlink !== 1) {
      throw new LinuxPowerHelperInstallationError("helper_link_count_invalid");
    }
    if (!this.#fileSystem.getProcessGroups().includes(helper.gid)) {
      throw new LinuxPowerHelperInstallationError(
        "helper_process_group_missing",
      );
    }

    for (const parentPath of ["/usr", "/usr/local", "/usr/local/libexec"]) {
      let parent: LinuxPowerHelperFileStats;
      try {
        parent = this.#fileSystem.lstat(parentPath);
      } catch (error) {
        if (isNotFoundError(error)) {
          throw new LinuxPowerHelperInstallationError("helper_parent_invalid");
        }
        throw new LinuxPowerHelperInstallationError("helper_inspection_failed");
      }
      if (
        parent.isSymbolicLink ||
        !parent.isDirectory ||
        (parent.mode & 0o022) !== 0
      ) {
        throw new LinuxPowerHelperInstallationError("helper_parent_invalid");
      }
      if (parent.uid !== 0) {
        throw new LinuxPowerHelperInstallationError(
          "helper_parent_owner_invalid",
        );
      }
    }
  }
}

const nodeFileSystem: LinuxPowerHelperFileSystem = Object.freeze({
  lstat(path: string): LinuxPowerHelperFileStats {
    const stats = lstatSync(path);
    return Object.freeze({
      isSymbolicLink: stats.isSymbolicLink(),
      isRegularFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      uid: stats.uid,
      gid: stats.gid,
      mode: stats.mode,
      nlink: stats.nlink,
    });
  },
  getProcessGroups(): readonly number[] {
    return process.getgroups?.() ?? [];
  },
});

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}
