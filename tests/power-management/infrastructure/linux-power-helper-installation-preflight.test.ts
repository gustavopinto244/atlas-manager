import { describe, expect, it, vi } from "vitest";

import {
  LinuxPowerHelperInstallationError,
  type LinuxPowerHelperInstallationInspector,
} from "../../../src/power-management/infrastructure/linux-power-helper-installation-inspector.js";
import {
  LinuxPowerHelperInstallationPreflightError,
  NodeLinuxPowerHelperInstallationPreflight,
  type LinuxPowerHelperSha256Hasher,
} from "../../../src/power-management/infrastructure/linux-power-helper-installation-preflight.js";

const EXPECTED = "a".repeat(64);

describe("Linux power-helper installation preflight", () => {
  it("reuses the installation inspector, hashes once, and accepts an exact match", () => {
    const inspector = { inspect: vi.fn() };
    const hasher = { hash: vi.fn(() => EXPECTED) };
    new NodeLinuxPowerHelperInstallationPreflight({
      inspector,
      hasher,
      platform: "linux",
    }).inspect(EXPECTED, 2000);

    expect(inspector.inspect).toHaveBeenCalledTimes(2);
    expect(inspector.inspect).toHaveBeenNthCalledWith(1, 2000);
    expect(inspector.inspect).toHaveBeenNthCalledWith(2, 2000);
    expect(hasher.hash).toHaveBeenCalledOnce();
  });

  it("rejects an expected hash mismatch without exposing either digest", () => {
    const preflight = createPreflight({ hash: "b".repeat(64) });

    let thrown: unknown;
    try {
      preflight.inspect(EXPECTED, 2000);
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toEqual(
      new LinuxPowerHelperInstallationPreflightError("helper_hash_mismatch"),
    );
    expect(String(thrown)).not.toContain(EXPECTED);
  });

  it.each([
    ["helper_not_found", "helper_missing"],
    ["helper_not_regular_file", "helper_not_regular"],
    ["helper_symbolic_link_rejected", "helper_symbolic_link"],
    ["helper_owner_invalid", "helper_owner_invalid"],
    ["helper_setuid_required", "helper_setuid_missing"],
    ["helper_group_invalid", "helper_group_invalid"],
    ["helper_process_group_missing", "process_group_membership_missing"],
    ["helper_mode_invalid", "helper_mode_invalid"],
    ["helper_link_count_invalid", "helper_link_count_invalid"],
    ["helper_parent_invalid", "helper_parent_unsafe"],
    ["helper_parent_owner_invalid", "helper_parent_unsafe"],
  ] as const)("maps %s to bounded code %s", (source, expected) => {
    const inspector: LinuxPowerHelperInstallationInspector = {
      inspect: vi.fn(() => {
        throw new LinuxPowerHelperInstallationError(source);
      }),
    };
    const preflight = new NodeLinuxPowerHelperInstallationPreflight({
      inspector,
      hasher: createHasher(EXPECTED),
      platform: "linux",
    });

    expect(() => preflight.inspect(EXPECTED, 2000)).toThrow(
      new LinuxPowerHelperInstallationPreflightError(expected),
    );
  });

  it("rejects platform mismatch, oversized hashing, and replacement during inspection", () => {
    const inspector = { inspect: vi.fn() };
    expect(() =>
      new NodeLinuxPowerHelperInstallationPreflight({
        inspector,
        hasher: createHasher(EXPECTED),
        platform: "darwin",
      }).inspect(EXPECTED, 2000),
    ).toThrow(
      new LinuxPowerHelperInstallationPreflightError("unsupported_platform"),
    );
    expect(inspector.inspect).not.toHaveBeenCalled();

    expect(() =>
      createPreflight({
        hashError: new LinuxPowerHelperInstallationPreflightError(
          "helper_size_invalid",
        ),
      }).inspect(EXPECTED, 2000),
    ).toThrow(
      new LinuxPowerHelperInstallationPreflightError("helper_size_invalid"),
    );

    let calls = 0;
    const changingInspector = {
      inspect: vi.fn(() => {
        calls += 1;
        if (calls === 2)
          throw new LinuxPowerHelperInstallationError("helper_mode_invalid");
      }),
    };
    expect(() =>
      new NodeLinuxPowerHelperInstallationPreflight({
        inspector: changingInspector,
        hasher: createHasher(EXPECTED),
        platform: "linux",
      }).inspect(EXPECTED, 2000),
    ).toThrow(
      new LinuxPowerHelperInstallationPreflightError("helper_mode_invalid"),
    );
  });
});

function createPreflight(options: {
  readonly hash?: string;
  readonly hashError?: Error;
}) {
  return new NodeLinuxPowerHelperInstallationPreflight({
    inspector: { inspect: vi.fn() },
    hasher: createHasher(options.hash ?? EXPECTED, options.hashError),
    platform: "linux",
  });
}

function createHasher(
  hash: string,
  error?: Error,
): LinuxPowerHelperSha256Hasher {
  return {
    hash: () => {
      if (error !== undefined) throw error;
      return hash;
    },
  };
}
