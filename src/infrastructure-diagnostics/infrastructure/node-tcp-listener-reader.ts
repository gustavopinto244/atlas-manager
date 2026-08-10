import { readFile } from "node:fs/promises";

import type {
  TcpListenerBinding,
  TcpListenerObservation,
  TcpListenerOutcome,
  TcpListenerReader,
} from "../ports/tcp-listener-reader.js";

/**
 * Listener enumeration parses `/proc` directly and spawns nothing (ADR-032 §8).
 *
 * This is strictly more bounded than `execFile("ss", …)`: no PATH resolution,
 * no subprocess, no timeout race, and the kernel caps the file size. It relies
 * on the standard Linux `/proc` layout, which is Atlas's documented deployment
 * target.
 */
export const PROC_NET_TCP_PATHS = Object.freeze([
  Object.freeze({ path: "/proc/net/tcp", family: "ipv4" as const }),
  Object.freeze({ path: "/proc/net/tcp6", family: "ipv6" as const }),
]);

/** `st` column value for a socket in LISTEN. */
const TCP_LISTEN_STATE = "0A";

const IPV4_WILDCARD = "00000000";
/** 127.0.0.1 as the little-endian word `/proc` reports. */
const IPV4_LOOPBACK_PREFIX = "7F";
const IPV6_WILDCARD = "0".repeat(32);
const IPV6_LOOPBACK = "00000000000000000000000001000000";
const IPV6_MAPPED_IPV4_PREFIX = "0000000000000000FFFF0000";

export type DiagnosticFileRead = (path: string) => Promise<string>;

const readTextFile: DiagnosticFileRead = (path) => readFile(path, "utf8");

export class NodeTcpListenerReader implements TcpListenerReader {
  public constructor(
    private readonly read_: DiagnosticFileRead = readTextFile,
  ) {}

  public async read(): Promise<TcpListenerOutcome> {
    const listeners: TcpListenerObservation[] = [];
    let readAny = false;
    let refusedForPrivilege = false;
    for (const source of PROC_NET_TCP_PATHS) {
      let contents: string;
      try {
        contents = await this.read_(source.path);
      } catch (error) {
        // A host without IPv6 has no /proc/net/tcp6 at all. Missing one source
        // is not a failed diagnostic as long as the other one answered.
        if (isPermissionDenied(error)) refusedForPrivilege = true;
        continue;
      }
      readAny = true;
      listeners.push(...parseListeners(contents, source.family));
    }
    if (!readAny)
      return Object.freeze({
        outcome: "undetermined" as const,
        code: refusedForPrivilege
          ? ("listener_permission_denied" as const)
          : ("listener_source_unreadable" as const),
        requiresPrivilege: refusedForPrivilege,
      });
    return Object.freeze({
      outcome: "observed" as const,
      listeners: Object.freeze(listeners),
    });
  }
}

function isPermissionDenied(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "EACCES" || code === "EPERM";
}

/**
 * A malformed line is skipped, never thrown. `/proc` is a kernel interface, but
 * a single unparsable row must not cost the operator the whole listener
 * diagnostic — nor the eleven other checks sharing the report.
 */
function parseListeners(
  contents: string,
  family: "ipv4" | "ipv6",
): readonly TcpListenerObservation[] {
  const observations: TcpListenerObservation[] = [];
  for (const line of contents.split("\n").slice(1)) {
    const columns = line.trim().split(/\s+/u);
    const localAddress = columns[1];
    const state = columns[3];
    if (localAddress === undefined || state === undefined) continue;
    if (state.toUpperCase() !== TCP_LISTEN_STATE) continue;
    const separator = localAddress.lastIndexOf(":");
    if (separator <= 0) continue;
    const host = localAddress.slice(0, separator).toUpperCase();
    const portHex = localAddress.slice(separator + 1);
    if (!/^[0-9A-F]+$/u.test(host) || !/^[0-9A-F]{1,4}$/iu.test(portHex))
      continue;
    const port = Number.parseInt(portHex, 16);
    if (!Number.isInteger(port) || port <= 0 || port > 65_535) continue;
    observations.push(
      Object.freeze({ port, binding: classifyBinding(host, family), family }),
    );
  }
  return observations;
}

function classifyBinding(
  host: string,
  family: "ipv4" | "ipv6",
): TcpListenerBinding {
  if (family === "ipv4") return classifyIpv4(host);
  if (host === IPV6_WILDCARD) return "wildcard";
  if (host === IPV6_LOOPBACK) return "loopback";
  if (host.startsWith(IPV6_MAPPED_IPV4_PREFIX))
    return classifyIpv4(host.slice(IPV6_MAPPED_IPV4_PREFIX.length));
  return "specific";
}

function classifyIpv4(host: string): TcpListenerBinding {
  if (host === IPV4_WILDCARD) return "wildcard";
  // `/proc` reports the address as a little-endian word, so the final octet
  // pair carries the leading 127 of a loopback address.
  return host.length === 8 && host.endsWith(IPV4_LOOPBACK_PREFIX)
    ? "loopback"
    : "specific";
}
