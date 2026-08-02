import { describe, expect, it } from "vitest";

import {
  ATLAS_MANAGER_POWER_GROUP,
  ATLAS_MANAGER_RUNTIME_GROUP,
  ATLAS_MANAGER_RUNTIME_HOME,
  ATLAS_MANAGER_RUNTIME_SHELL,
  ATLAS_MANAGER_RUNTIME_USER,
  LinuxPowerRuntimeIdentityError,
  NodeLinuxPowerRuntimeIdentityInspector,
  type LinuxPowerRuntimeIdentityFileStats,
  type LinuxPowerRuntimeIdentityProcess,
} from "../../../src/power-management/infrastructure/linux-power-runtime-identity-inspector.js";

const IDS = Object.freeze({
  userId: 1001,
  primaryGroupId: 1001,
  helperGroupId: 1002,
});

const safeDirectory: LinuxPowerRuntimeIdentityFileStats = {
  isSymbolicLink: false,
  isRegularFile: false,
  isDirectory: true,
  uid: 0,
  mode: 0o755,
  nlink: 1,
  size: 0,
};
const safeFile: LinuxPowerRuntimeIdentityFileStats = {
  isSymbolicLink: false,
  isRegularFile: true,
  isDirectory: false,
  uid: 0,
  mode: 0o644,
  nlink: 1,
  size: 256,
};

describe("Linux power runtime identity inspection", () => {
  it("accepts and freezes the exact dedicated runtime identity", () => {
    const inspector = createInspector();

    const identity = inspector.inspect();

    expect(identity).toEqual(IDS);
    expect(Object.isFrozen(identity)).toBe(true);
  });

  it.each([
    [
      "non-linux",
      { platform: "darwin" as const },
      "runtime_identity_unsupported",
    ],
    [
      "missing UID API",
      {
        process: {
          ...validProcess,
          getuid: undefined,
        } as unknown as LinuxPowerRuntimeIdentityProcess,
      },
      "runtime_identity_unsupported",
    ],
    [
      "missing GID API",
      {
        process: {
          ...validProcess,
          getgid: undefined,
        } as unknown as LinuxPowerRuntimeIdentityProcess,
      },
      "runtime_identity_unsupported",
    ],
    [
      "root real UID",
      { process: { ...validProcess, getuid: (): number => 0 } },
      "runtime_user_root",
    ],
    [
      "root effective UID",
      { process: { ...validProcess, geteuid: (): number => 0 } },
      "runtime_user_root",
    ],
    [
      "UID mismatch",
      { process: { ...validProcess, geteuid: (): number => 1002 } },
      "runtime_user_mismatch",
    ],
    [
      "root primary GID",
      { process: { ...validProcess, getgid: (): number => 0 } },
      "runtime_primary_group_invalid",
    ],
    [
      "GID mismatch",
      { process: { ...validProcess, getegid: (): number => 1002 } },
      "runtime_primary_group_invalid",
    ],
    [
      "root supplementary group",
      {
        process: {
          ...validProcess,
          getgroups: (): number[] => [0, 1002],
        },
      },
      "runtime_root_group_membership_rejected",
    ],
  ] as const)("rejects %s", (_label, options, code) => {
    expect(() => createInspector(options).inspect()).toThrowError(
      new LinuxPowerRuntimeIdentityError(code),
    );
  });

  it("accepts additional non-root supplementary groups and ignores identity environment values", () => {
    const originalUser = process.env.USER;
    const originalLogname = process.env.LOGNAME;
    process.env.USER = "root";
    process.env.LOGNAME = "root";
    const inspector = createInspector({
      process: { ...validProcess, getgroups: () => [IDS.helperGroupId, 2000] },
    });

    try {
      expect(inspector.inspect()).toEqual(IDS);
    } finally {
      if (originalUser === undefined) delete process.env.USER;
      else process.env.USER = originalUser;
      if (originalLogname === undefined) delete process.env.LOGNAME;
      else process.env.LOGNAME = originalLogname;
    }
  });

  it.each([
    [
      "wrong user name",
      { passwd: passwdWithUser("another-user") },
      "runtime_user_missing",
    ],
    [
      "missing user",
      { passwd: passwdWithoutRuntimeUser() },
      "runtime_user_missing",
    ],
    [
      "duplicate user",
      { passwd: `${validPasswd}\n${validRuntimeUser}` },
      "runtime_user_duplicate",
    ],
    [
      "duplicate process UID",
      {
        passwd: `${validPasswd}\nother:x:1001:2000::/home/other:/usr/sbin/nologin`,
      },
      "runtime_user_duplicate",
    ],
    [
      "wrong home",
      { passwd: passwdWithUser(ATLAS_MANAGER_RUNTIME_USER, "/wrong") },
      "runtime_user_home_invalid",
    ],
    [
      "wrong shell",
      {
        passwd: passwdWithUser(
          ATLAS_MANAGER_RUNTIME_USER,
          ATLAS_MANAGER_RUNTIME_HOME,
          "/bin/sh",
        ),
      },
      "runtime_user_shell_invalid",
    ],
    [
      "missing primary group",
      { group: groupWithout(ATLAS_MANAGER_RUNTIME_GROUP) },
      "runtime_primary_group_missing",
    ],
    [
      "duplicate primary group",
      { group: `${validGroup}\n${validPrimaryGroup}` },
      "runtime_primary_group_duplicate",
    ],
    [
      "wrong primary group",
      { group: groupWithPrimaryId(2000) },
      "runtime_primary_group_invalid",
    ],
    [
      "missing helper group",
      { group: groupWithout(ATLAS_MANAGER_POWER_GROUP) },
      "runtime_helper_group_missing",
    ],
    [
      "duplicate helper group",
      { group: `${validGroup}\n${validHelperGroup}` },
      "runtime_helper_group_duplicate",
    ],
    [
      "helper group is root",
      { group: groupWithHelperId(0) },
      "runtime_helper_group_invalid",
    ],
    [
      "helper shares primary GID",
      { group: groupWithHelperId(IDS.primaryGroupId) },
      "runtime_primary_group_duplicate",
    ],
    [
      "helper membership missing",
      { process: { ...validProcess, getgroups: () => [] } },
      "runtime_helper_group_membership_missing",
    ],
  ] as const)("rejects %s", (_label, options, code) => {
    expect(() => createInspector(options).inspect()).toThrowError(
      new LinuxPowerRuntimeIdentityError(code),
    );
  });

  it.each([
    ["unsafe /etc", { etc: { ...safeDirectory, mode: 0o775 } }],
    ["unsafe passwd ownership", { passwdStats: { ...safeFile, uid: 1000 } }],
    ["passwd symlink", { passwdStats: { ...safeFile, isSymbolicLink: true } }],
    ["group nonregular", { groupStats: { ...safeFile, isRegularFile: false } }],
    ["oversized passwd", { passwdStats: { ...safeFile, size: 1_048_577 } }],
    ["oversized group", { groupStats: { ...safeFile, size: 1_048_577 } }],
    ["oversized line", { passwd: `atlas-manager:${"x".repeat(4_097)}` }],
    ["NUL", { passwd: `${validPasswd}\u0000` }],
    [
      "malformed matching entry",
      { passwd: `${validPasswd}\natlas-manager:x:1001` },
    ],
    [
      "noncanonical UID",
      { passwd: validPasswd.replace(":1001:1001:", ":01001:1001:") },
    ],
  ] as const)("rejects %s account state", (_label, options) => {
    expect(() => createInspector(options).inspect()).toThrow();
  });

  it("does not read real account files when the platform is unsupported", () => {
    const fileSystem = createFileSystem();
    expect(() =>
      new NodeLinuxPowerRuntimeIdentityInspector({
        platform: "darwin",
        fileSystem,
        process: validProcess,
      }).inspect(),
    ).toThrowError(
      new LinuxPowerRuntimeIdentityError("runtime_identity_unsupported"),
    );
    expect(fileSystem.lstatCalls).toEqual([]);
    expect(fileSystem.readFileCalls).toEqual([]);
  });
});

const validRuntimeUser = `${ATLAS_MANAGER_RUNTIME_USER}:x:${IDS.userId}:${IDS.primaryGroupId}::${ATLAS_MANAGER_RUNTIME_HOME}:${ATLAS_MANAGER_RUNTIME_SHELL}`;
const validPasswd = `root:x:0:0::/root:/usr/sbin/nologin\n${validRuntimeUser}`;
const validPrimaryGroup = `${ATLAS_MANAGER_RUNTIME_GROUP}:x:${IDS.primaryGroupId}:`;
const validHelperGroup = `${ATLAS_MANAGER_POWER_GROUP}:x:${IDS.helperGroupId}:`;
const validGroup = `root:x:0:\n${validPrimaryGroup}\n${validHelperGroup}`;
const validProcess: LinuxPowerRuntimeIdentityProcess = {
  getuid: () => IDS.userId,
  geteuid: () => IDS.userId,
  getgid: () => IDS.primaryGroupId,
  getegid: () => IDS.primaryGroupId,
  getgroups: () => [IDS.helperGroupId],
};

function createInspector(
  options: {
    readonly platform?: NodeJS.Platform;
    readonly process?: LinuxPowerRuntimeIdentityProcess;
    readonly passwd?: string;
    readonly group?: string;
    readonly etc?: LinuxPowerRuntimeIdentityFileStats;
    readonly passwdStats?: LinuxPowerRuntimeIdentityFileStats;
    readonly groupStats?: LinuxPowerRuntimeIdentityFileStats;
  } = {},
) {
  const fileSystem = createFileSystem(options);
  return new NodeLinuxPowerRuntimeIdentityInspector({
    platform: options.platform ?? "linux",
    process: options.process ?? validProcess,
    fileSystem,
  });
}

function createFileSystem(
  options: {
    readonly passwd?: string;
    readonly group?: string;
    readonly etc?: LinuxPowerRuntimeIdentityFileStats;
    readonly passwdStats?: LinuxPowerRuntimeIdentityFileStats;
    readonly groupStats?: LinuxPowerRuntimeIdentityFileStats;
  } = {},
) {
  const files = new Map([
    ["/etc", options.etc ?? safeDirectory],
    ["/etc/passwd", options.passwdStats ?? safeFile],
    ["/etc/group", options.groupStats ?? safeFile],
  ]);
  const contents = new Map([
    ["/etc/passwd", options.passwd ?? validPasswd],
    ["/etc/group", options.group ?? validGroup],
  ]);
  const lstatCalls: string[] = [];
  const readFileCalls: string[] = [];
  return {
    lstatCalls,
    readFileCalls,
    lstat(path: string) {
      lstatCalls.push(path);
      const stats = files.get(path);
      if (stats === undefined) throw new Error("missing fixed file");
      return stats;
    },
    readFile(path: string) {
      readFileCalls.push(path);
      return Buffer.from(contents.get(path) ?? "", "utf8");
    },
  };
}

function passwdWithUser(
  name: string,
  home: string = ATLAS_MANAGER_RUNTIME_HOME,
  shell: string = ATLAS_MANAGER_RUNTIME_SHELL,
): string {
  return `root:x:0:0::/root:/usr/sbin/nologin\n${name}:x:${IDS.userId}:${IDS.primaryGroupId}::${home}:${shell}`;
}

function passwdWithoutRuntimeUser(): string {
  return "root:x:0:0::/root:/usr/sbin/nologin";
}

function groupWithout(name: string): string {
  return validGroup
    .split("\n")
    .filter((line) => !line.startsWith(`${name}:`))
    .join("\n");
}

function groupWithPrimaryId(groupId: number): string {
  return `root:x:0:\n${ATLAS_MANAGER_RUNTIME_GROUP}:x:${groupId}:\n${validHelperGroup}`;
}

function groupWithHelperId(groupId: number): string {
  return `root:x:0:\n${validPrimaryGroup}\n${ATLAS_MANAGER_POWER_GROUP}:x:${groupId}:`;
}
