import { readFileSync, lstatSync } from "node:fs";
import { TextDecoder } from "node:util";

export const ATLAS_MANAGER_RUNTIME_USER = "atlas-manager" as const;
export const ATLAS_MANAGER_RUNTIME_GROUP = "atlas-manager" as const;
export const ATLAS_MANAGER_RUNTIME_HOME = "/var/lib/atlas-manager" as const;
export const ATLAS_MANAGER_RUNTIME_SHELL = "/usr/sbin/nologin" as const;
export const ATLAS_MANAGER_POWER_GROUP = "atlas-manager-power" as const;

const ETC_PATH = "/etc" as const;
const PASSWD_PATH = "/etc/passwd" as const;
const GROUP_PATH = "/etc/group" as const;
const MAX_ACCOUNT_FILE_BYTES = 1_048_576;
const MAX_ACCOUNT_LINE_BYTES = 4_096;

export type LinuxPowerRuntimeIdentity = Readonly<{
  userId: number;
  primaryGroupId: number;
  helperGroupId: number;
}>;

export type LinuxPowerRuntimeIdentityErrorCode =
  | "runtime_identity_unsupported"
  | "runtime_identity_files_unsafe"
  | "runtime_identity_files_oversized"
  | "runtime_identity_malformed"
  | "runtime_user_missing"
  | "runtime_user_duplicate"
  | "runtime_user_root"
  | "runtime_user_mismatch"
  | "runtime_user_home_invalid"
  | "runtime_user_shell_invalid"
  | "runtime_primary_group_missing"
  | "runtime_primary_group_duplicate"
  | "runtime_primary_group_invalid"
  | "runtime_helper_group_missing"
  | "runtime_helper_group_duplicate"
  | "runtime_helper_group_invalid"
  | "runtime_helper_group_membership_missing"
  | "runtime_root_group_membership_rejected"
  | "runtime_identity_inspection_failed";

export class LinuxPowerRuntimeIdentityError extends Error {
  public override readonly name = "LinuxPowerRuntimeIdentityError";

  public constructor(public readonly code: LinuxPowerRuntimeIdentityErrorCode) {
    super(`Linux power runtime identity is invalid: ${code}`);
    Object.freeze(this);
  }
}

export interface LinuxPowerRuntimeIdentityInspector {
  inspect(): LinuxPowerRuntimeIdentity;
}

export interface LinuxPowerRuntimeIdentityProcess {
  readonly getuid?: () => number;
  readonly geteuid?: () => number;
  readonly getgid?: () => number;
  readonly getegid?: () => number;
  readonly getgroups?: () => readonly number[];
}

export interface LinuxPowerRuntimeIdentityFileStats {
  readonly isSymbolicLink: boolean;
  readonly isRegularFile: boolean;
  readonly isDirectory: boolean;
  readonly uid: number;
  readonly mode: number;
  readonly nlink: number;
  readonly size: number;
}

export interface LinuxPowerRuntimeIdentityFileSystem {
  lstat(path: string): LinuxPowerRuntimeIdentityFileStats;
  readFile(path: string): Uint8Array;
}

export interface NodeLinuxPowerRuntimeIdentityInspectorDependencies {
  readonly platform?: NodeJS.Platform;
  readonly process?: LinuxPowerRuntimeIdentityProcess;
  readonly fileSystem?: LinuxPowerRuntimeIdentityFileSystem;
}

interface PasswdEntry {
  readonly name: string;
  readonly userId: number;
  readonly primaryGroupId: number;
  readonly home: string;
  readonly shell: string;
}

interface GroupEntry {
  readonly name: string;
  readonly groupId: number;
}

export class NodeLinuxPowerRuntimeIdentityInspector implements LinuxPowerRuntimeIdentityInspector {
  readonly #platform: NodeJS.Platform;
  readonly #process: LinuxPowerRuntimeIdentityProcess;
  readonly #fileSystem: LinuxPowerRuntimeIdentityFileSystem;

  public constructor(
    dependencies: NodeLinuxPowerRuntimeIdentityInspectorDependencies = {},
  ) {
    this.#platform = dependencies.platform ?? process.platform;
    this.#process = dependencies.process ?? nodeProcess;
    this.#fileSystem = dependencies.fileSystem ?? nodeFileSystem;
    Object.freeze(this);
  }

  public inspect(): LinuxPowerRuntimeIdentity {
    if (this.#platform !== "linux")
      throw new LinuxPowerRuntimeIdentityError("runtime_identity_unsupported");

    const processIdentity = readProcessIdentity(this.#process);
    validateEtcDirectory(this.#fileSystem);
    const passwd = readAccountFile(PASSWD_PATH, this.#fileSystem);
    const groups = readAccountFile(GROUP_PATH, this.#fileSystem);
    const passwdEntries = parsePasswd(passwd);
    const groupEntries = parseGroups(groups);

    if (processIdentity.userId === 0 || processIdentity.effectiveUserId === 0)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_root");
    if (processIdentity.userId !== processIdentity.effectiveUserId)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_mismatch");
    if (processIdentity.groupId === 0 || processIdentity.effectiveGroupId === 0)
      throw new LinuxPowerRuntimeIdentityError("runtime_primary_group_invalid");
    if (processIdentity.groupId !== processIdentity.effectiveGroupId)
      throw new LinuxPowerRuntimeIdentityError("runtime_primary_group_invalid");
    if (processIdentity.groups.includes(0))
      throw new LinuxPowerRuntimeIdentityError(
        "runtime_root_group_membership_rejected",
      );

    const runtimeUsers = passwdEntries.filter(
      (entry) => entry.name === ATLAS_MANAGER_RUNTIME_USER,
    );
    if (runtimeUsers.length === 0)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_missing");
    if (runtimeUsers.length !== 1)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_duplicate");
    const runtimeUser = runtimeUsers[0];
    if (runtimeUser === undefined)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_missing");

    const usersWithProcessId = passwdEntries.filter(
      (entry) => entry.userId === processIdentity.userId,
    );
    if (usersWithProcessId.length !== 1)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_duplicate");
    if (usersWithProcessId[0]?.name !== ATLAS_MANAGER_RUNTIME_USER)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_mismatch");
    if (
      runtimeUser.userId !== processIdentity.userId ||
      runtimeUser.primaryGroupId !== processIdentity.groupId
    )
      throw new LinuxPowerRuntimeIdentityError("runtime_user_mismatch");
    if (
      runtimeUser.home !== ATLAS_MANAGER_RUNTIME_HOME ||
      !isSafeHome(runtimeUser.home)
    )
      throw new LinuxPowerRuntimeIdentityError("runtime_user_home_invalid");
    if (runtimeUser.shell !== ATLAS_MANAGER_RUNTIME_SHELL)
      throw new LinuxPowerRuntimeIdentityError("runtime_user_shell_invalid");

    const primaryGroups = groupEntries.filter(
      (entry) => entry.name === ATLAS_MANAGER_RUNTIME_GROUP,
    );
    if (primaryGroups.length === 0)
      throw new LinuxPowerRuntimeIdentityError("runtime_primary_group_missing");
    if (primaryGroups.length !== 1)
      throw new LinuxPowerRuntimeIdentityError(
        "runtime_primary_group_duplicate",
      );
    const primaryGroup = primaryGroups[0];
    if (primaryGroup === undefined)
      throw new LinuxPowerRuntimeIdentityError("runtime_primary_group_missing");
    if (primaryGroup.groupId !== processIdentity.groupId)
      throw new LinuxPowerRuntimeIdentityError("runtime_primary_group_invalid");
    if (
      groupEntries.filter((entry) => entry.groupId === processIdentity.groupId)
        .length !== 1
    )
      throw new LinuxPowerRuntimeIdentityError(
        "runtime_primary_group_duplicate",
      );

    const helperGroups = groupEntries.filter(
      (entry) => entry.name === ATLAS_MANAGER_POWER_GROUP,
    );
    if (helperGroups.length === 0)
      throw new LinuxPowerRuntimeIdentityError("runtime_helper_group_missing");
    if (helperGroups.length !== 1)
      throw new LinuxPowerRuntimeIdentityError(
        "runtime_helper_group_duplicate",
      );
    const helperGroup = helperGroups[0];
    if (helperGroup === undefined)
      throw new LinuxPowerRuntimeIdentityError("runtime_helper_group_missing");
    if (
      helperGroup.groupId <= 0 ||
      helperGroup.groupId === processIdentity.groupId ||
      groupEntries.filter((entry) => entry.groupId === helperGroup.groupId)
        .length !== 1
    )
      throw new LinuxPowerRuntimeIdentityError("runtime_helper_group_invalid");
    if (!processIdentity.groups.includes(helperGroup.groupId))
      throw new LinuxPowerRuntimeIdentityError(
        "runtime_helper_group_membership_missing",
      );

    return Object.freeze({
      userId: processIdentity.userId,
      primaryGroupId: processIdentity.groupId,
      helperGroupId: helperGroup.groupId,
    });
  }
}

interface ProcessIdentity {
  readonly userId: number;
  readonly effectiveUserId: number;
  readonly groupId: number;
  readonly effectiveGroupId: number;
  readonly groups: readonly number[];
}

function readProcessIdentity(
  processIdentity: LinuxPowerRuntimeIdentityProcess,
): ProcessIdentity {
  if (
    processIdentity.getuid === undefined ||
    processIdentity.geteuid === undefined ||
    processIdentity.getgid === undefined ||
    processIdentity.getegid === undefined ||
    processIdentity.getgroups === undefined
  )
    throw new LinuxPowerRuntimeIdentityError("runtime_identity_unsupported");
  try {
    const groups: unknown = processIdentity.getgroups();
    if (!isCanonicalIdArray(groups))
      throw new LinuxPowerRuntimeIdentityError(
        "runtime_identity_inspection_failed",
      );
    return {
      userId: requireProcessId(processIdentity.getuid()),
      effectiveUserId: requireProcessId(processIdentity.geteuid()),
      groupId: requireProcessId(processIdentity.getgid()),
      effectiveGroupId: requireProcessId(processIdentity.getegid()),
      groups: Object.freeze([...groups]),
    };
  } catch (error) {
    if (error instanceof LinuxPowerRuntimeIdentityError) throw error;
    throw new LinuxPowerRuntimeIdentityError(
      "runtime_identity_inspection_failed",
    );
  }
}

function readAccountFile(
  path: string,
  fileSystem: LinuxPowerRuntimeIdentityFileSystem,
): string {
  let stats: LinuxPowerRuntimeIdentityFileStats;
  try {
    stats = fileSystem.lstat(path);
  } catch {
    throw new LinuxPowerRuntimeIdentityError("runtime_identity_files_unsafe");
  }
  if (
    stats.isSymbolicLink ||
    !stats.isRegularFile ||
    stats.isDirectory ||
    stats.uid !== 0 ||
    (stats.mode & 0o022) !== 0 ||
    stats.nlink !== 1
  )
    throw new LinuxPowerRuntimeIdentityError("runtime_identity_files_unsafe");
  if (stats.size < 0 || stats.size > MAX_ACCOUNT_FILE_BYTES)
    throw new LinuxPowerRuntimeIdentityError(
      "runtime_identity_files_oversized",
    );

  let bytes: Uint8Array;
  try {
    bytes = fileSystem.readFile(path);
  } catch {
    throw new LinuxPowerRuntimeIdentityError(
      "runtime_identity_inspection_failed",
    );
  }
  if (bytes.byteLength > MAX_ACCOUNT_FILE_BYTES)
    throw new LinuxPowerRuntimeIdentityError(
      "runtime_identity_files_oversized",
    );
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (value.includes("\u0000"))
      throw new LinuxPowerRuntimeIdentityError("runtime_identity_malformed");
    return value;
  } catch (error) {
    if (error instanceof LinuxPowerRuntimeIdentityError) throw error;
    throw new LinuxPowerRuntimeIdentityError("runtime_identity_malformed");
  }
}

function validateEtcDirectory(
  fileSystem: LinuxPowerRuntimeIdentityFileSystem,
): void {
  let stats: LinuxPowerRuntimeIdentityFileStats;
  try {
    stats = fileSystem.lstat(ETC_PATH);
  } catch {
    throw new LinuxPowerRuntimeIdentityError("runtime_identity_files_unsafe");
  }
  if (
    stats.isSymbolicLink ||
    !stats.isDirectory ||
    stats.isRegularFile ||
    stats.uid !== 0 ||
    (stats.mode & 0o022) !== 0
  )
    throw new LinuxPowerRuntimeIdentityError("runtime_identity_files_unsafe");
}

function parsePasswd(value: string): readonly PasswdEntry[] {
  return value.split("\n").flatMap((line) => {
    if (line.length === 0) return [];
    assertLineSize(line);
    const fields = line.split(":");
    if (fields.length !== 7 || fields.some(hasControlCharacter))
      throw new LinuxPowerRuntimeIdentityError("runtime_identity_malformed");
    const name = fields[0];
    const userId = parseId(fields[2]);
    const primaryGroupId = parseId(fields[3]);
    const home = fields[5];
    const shell = fields[6];
    if (
      name === undefined ||
      name.length === 0 ||
      userId === undefined ||
      primaryGroupId === undefined ||
      home === undefined ||
      shell === undefined
    )
      throw new LinuxPowerRuntimeIdentityError("runtime_identity_malformed");
    return [{ name, userId, primaryGroupId, home, shell }];
  });
}

function parseGroups(value: string): readonly GroupEntry[] {
  return value.split("\n").flatMap((line) => {
    if (line.length === 0) return [];
    assertLineSize(line);
    const fields = line.split(":");
    if (fields.length !== 4 || fields.some(hasControlCharacter))
      throw new LinuxPowerRuntimeIdentityError("runtime_identity_malformed");
    const name = fields[0];
    const groupId = parseId(fields[2]);
    if (name === undefined || name.length === 0 || groupId === undefined)
      throw new LinuxPowerRuntimeIdentityError("runtime_identity_malformed");
    return [{ name, groupId }];
  });
}

function assertLineSize(line: string): void {
  if (Buffer.byteLength(line, "utf8") > MAX_ACCOUNT_LINE_BYTES)
    throw new LinuxPowerRuntimeIdentityError(
      "runtime_identity_files_oversized",
    );
}

function parseId(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/u.test(value))
    return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function requireProcessId(value: number): number {
  if (!isCanonicalId(value))
    throw new LinuxPowerRuntimeIdentityError(
      "runtime_identity_inspection_failed",
    );
  return value;
}

function isCanonicalId(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isCanonicalIdArray(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item): item is number => typeof item === "number" && isCanonicalId(item),
    )
  );
}

function isSafeHome(value: string): boolean {
  return value.startsWith("/") && value !== "/" && value !== "/root";
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return true;
  }
  return false;
}

const nodeProcess: LinuxPowerRuntimeIdentityProcess = Object.freeze({
  ...(process.getuid === undefined
    ? {}
    : { getuid: process.getuid.bind(process) }),
  ...(process.geteuid === undefined
    ? {}
    : { geteuid: process.geteuid.bind(process) }),
  ...(process.getgid === undefined
    ? {}
    : { getgid: process.getgid.bind(process) }),
  ...(process.getegid === undefined
    ? {}
    : { getegid: process.getegid.bind(process) }),
  ...(process.getgroups === undefined
    ? {}
    : { getgroups: process.getgroups.bind(process) }),
});

const nodeFileSystem: LinuxPowerRuntimeIdentityFileSystem = Object.freeze({
  lstat(path: string): LinuxPowerRuntimeIdentityFileStats {
    const stats = lstatSync(path);
    return Object.freeze({
      isSymbolicLink: stats.isSymbolicLink(),
      isRegularFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      uid: stats.uid,
      mode: stats.mode,
      nlink: stats.nlink,
      size: stats.size,
    });
  },
  readFile(path: string): Uint8Array {
    return readFileSync(path);
  },
});
