import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";
import {
  LINUX_POWER_HELPER_PATH,
  LinuxPowerHelperInstallationError,
  NodeLinuxPowerHelperInstallationInspector,
  type LinuxPowerHelperInstallationInspector,
} from "./linux-power-helper-installation-inspector.js";

const MAX_HELPER_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

export type LinuxPowerHelperInstallationPreflightErrorCode =
  | "unsupported_platform"
  | "helper_missing"
  | "helper_not_regular"
  | "helper_symbolic_link"
  | "helper_owner_invalid"
  | "helper_group_invalid"
  | "helper_mode_invalid"
  | "helper_setuid_missing"
  | "helper_link_count_invalid"
  | "helper_parent_unsafe"
  | "process_group_membership_missing"
  | "helper_size_invalid"
  | "helper_hash_mismatch"
  | "helper_inspection_failed";

export class LinuxPowerHelperInstallationPreflightError extends Error {
  public override readonly name = "LinuxPowerHelperInstallationPreflightError";

  public constructor(
    public readonly code: LinuxPowerHelperInstallationPreflightErrorCode,
  ) {
    super(`Linux power-helper preflight blocked: ${code}`);
    Object.freeze(this);
  }
}

export interface LinuxPowerHelperSha256Hasher {
  hash(): string;
}

export interface LinuxPowerHelperInstallationPreflight {
  inspect(expectedSha256: string): void;
}

export interface NodeLinuxPowerHelperInstallationPreflightDependencies {
  readonly inspector?: LinuxPowerHelperInstallationInspector;
  readonly hasher?: LinuxPowerHelperSha256Hasher;
  readonly platform?: NodeJS.Platform;
}

export class NodeLinuxPowerHelperInstallationPreflight implements LinuxPowerHelperInstallationPreflight {
  readonly #inspector: LinuxPowerHelperInstallationInspector;
  readonly #hasher: LinuxPowerHelperSha256Hasher;
  readonly #platform: NodeJS.Platform;

  public constructor(
    dependencies: NodeLinuxPowerHelperInstallationPreflightDependencies = {},
  ) {
    this.#inspector =
      dependencies.inspector ?? new NodeLinuxPowerHelperInstallationInspector();
    this.#hasher =
      dependencies.hasher ?? new NodeLinuxPowerHelperSha256Hasher();
    this.#platform = dependencies.platform ?? process.platform;
    Object.freeze(this);
  }

  public inspect(expectedSha256: string): void {
    if (this.#platform !== "linux") {
      throw new LinuxPowerHelperInstallationPreflightError(
        "unsupported_platform",
      );
    }

    try {
      this.#inspector.inspect();
    } catch (error) {
      throw mapInstallationError(error);
    }

    let actualSha256: string;
    try {
      actualSha256 = this.#hasher.hash();
    } catch (error) {
      if (error instanceof LinuxPowerHelperInstallationPreflightError)
        throw error;
      throw new LinuxPowerHelperInstallationPreflightError(
        "helper_inspection_failed",
      );
    }

    try {
      this.#inspector.inspect();
    } catch (error) {
      throw mapInstallationError(error);
    }

    if (actualSha256 !== expectedSha256) {
      throw new LinuxPowerHelperInstallationPreflightError(
        "helper_hash_mismatch",
      );
    }
  }
}

export class NodeLinuxPowerHelperSha256Hasher implements LinuxPowerHelperSha256Hasher {
  public hash(): string {
    let descriptor: number;
    try {
      descriptor = openSync(
        LINUX_POWER_HELPER_PATH,
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
    } catch {
      throw new LinuxPowerHelperInstallationPreflightError(
        "helper_inspection_failed",
      );
    }

    try {
      const initial = fstatSync(descriptor);
      if (!initial.isFile() || initial.nlink !== 1 || initial.size < 0)
        throw new LinuxPowerHelperInstallationPreflightError(
          "helper_inspection_failed",
        );
      if (initial.size > MAX_HELPER_BYTES)
        throw new LinuxPowerHelperInstallationPreflightError(
          "helper_size_invalid",
        );

      const digest = createHash("sha256");
      const buffer = Buffer.allocUnsafe(READ_CHUNK_BYTES);
      let total = 0;
      while (true) {
        const count = readSync(descriptor, buffer, 0, buffer.length, null);
        if (count === 0) break;
        total += count;
        if (total > MAX_HELPER_BYTES)
          throw new LinuxPowerHelperInstallationPreflightError(
            "helper_size_invalid",
          );
        digest.update(buffer.subarray(0, count));
      }

      const final = fstatSync(descriptor);
      if (
        final.dev !== initial.dev ||
        final.ino !== initial.ino ||
        final.size !== initial.size ||
        final.nlink !== initial.nlink
      )
        throw new LinuxPowerHelperInstallationPreflightError(
          "helper_inspection_failed",
        );
      return digest.digest("hex");
    } catch (error) {
      if (error instanceof LinuxPowerHelperInstallationPreflightError)
        throw error;
      throw new LinuxPowerHelperInstallationPreflightError(
        "helper_inspection_failed",
      );
    } finally {
      try {
        closeSync(descriptor);
      } catch {
        // The primary inspection result remains authoritative.
      }
    }
  }
}

function mapInstallationError(
  error: unknown,
): LinuxPowerHelperInstallationPreflightError {
  if (!(error instanceof LinuxPowerHelperInstallationError))
    return new LinuxPowerHelperInstallationPreflightError(
      "helper_inspection_failed",
    );
  const map: Partial<
    Record<
      LinuxPowerHelperInstallationError["code"],
      LinuxPowerHelperInstallationPreflightErrorCode
    >
  > = {
    helper_not_found: "helper_missing",
    helper_not_regular_file: "helper_not_regular",
    helper_symbolic_link_rejected: "helper_symbolic_link",
    helper_owner_invalid: "helper_owner_invalid",
    helper_setuid_required: "helper_setuid_missing",
    helper_group_invalid: "helper_group_invalid",
    helper_process_group_missing: "process_group_membership_missing",
    helper_mode_invalid: "helper_mode_invalid",
    helper_link_count_invalid: "helper_link_count_invalid",
    helper_parent_invalid: "helper_parent_unsafe",
    helper_parent_owner_invalid: "helper_parent_unsafe",
    helper_inspection_failed: "helper_inspection_failed",
  };
  return new LinuxPowerHelperInstallationPreflightError(
    map[error.code] ?? "helper_inspection_failed",
  );
}
