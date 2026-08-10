import { describe, expect, it, vi } from "vitest";

import { NodeTcpListenerReader } from "../../../src/infrastructure-diagnostics/infrastructure/node-tcp-listener-reader.js";

const HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

function ipv4Only(body: string) {
  return vi.fn(async (path: string) => {
    if (path === "/proc/net/tcp") return HEADER + body;
    throw Object.assign(new Error("no ipv6"), { code: "ENOENT" });
  });
}

describe("NodeTcpListenerReader", () => {
  it("reads /proc directly and spawns nothing", async () => {
    const read = ipv4Only("");
    await new NodeTcpListenerReader(read).read();
    expect(read.mock.calls.map((call) => call[0])).toEqual([
      "/proc/net/tcp",
      "/proc/net/tcp6",
    ]);
  });

  it("classifies a loopback LISTEN socket", async () => {
    // 0100007F:0BB8 is 127.0.0.1:3000 in /proc's little-endian hex.
    const outcome = await new NodeTcpListenerReader(
      ipv4Only("   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000\n"),
    ).read();
    expect(outcome).toEqual({
      outcome: "observed",
      listeners: [{ port: 3000, binding: "loopback", family: "ipv4" }],
    });
  });

  it("classifies a wildcard LISTEN socket", async () => {
    const outcome = await new NodeTcpListenerReader(
      ipv4Only("   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000\n"),
    ).read();
    expect(outcome).toMatchObject({
      listeners: [{ port: 3000, binding: "wildcard", family: "ipv4" }],
    });
  });

  it("classifies a specific-address LISTEN socket", async () => {
    // 0200A8C0 is 192.168.0.2.
    const outcome = await new NodeTcpListenerReader(
      ipv4Only("   0: 0200A8C0:0BB8 00000000:0000 0A 00000000:00000000\n"),
    ).read();
    expect(outcome).toMatchObject({
      listeners: [{ port: 3000, binding: "specific", family: "ipv4" }],
    });
  });

  it("ignores sockets that are not in LISTEN", async () => {
    const outcome = await new NodeTcpListenerReader(
      ipv4Only(
        "   0: 0100007F:0BB8 0100007F:C001 01 00000000:00000000\n" +
          "   1: 0100007F:0BB9 00000000:0000 0A 00000000:00000000\n",
      ),
    ).read();
    expect(outcome).toMatchObject({
      listeners: [{ port: 3001, binding: "loopback", family: "ipv4" }],
    });
  });

  it("reports no listeners when nothing is listening", async () => {
    await expect(
      new NodeTcpListenerReader(ipv4Only("")).read(),
    ).resolves.toEqual({ outcome: "observed", listeners: [] });
  });

  // One unparsable kernel row must not cost the operator the listener
  // diagnostic, nor the eleven other checks that share the report.
  it("skips a malformed line instead of failing the whole read", async () => {
    const outcome = await new NodeTcpListenerReader(
      ipv4Only(
        "garbage\n" +
          "   1: NOTHEX:ZZZZ 00000000:0000 0A\n" +
          "   2: 0100007F:0BB8 00000000:0000 0A 00000000:00000000\n",
      ),
    ).read();
    expect(outcome).toMatchObject({
      listeners: [{ port: 3000, binding: "loopback" }],
    });
  });

  it("classifies IPv6 loopback and wildcard binds", async () => {
    const read = vi.fn(async (path: string) =>
      path === "/proc/net/tcp"
        ? HEADER
        : HEADER +
          "   0: 00000000000000000000000001000000:0BB8 00000000000000000000000000000000:0000 0A\n" +
          "   1: 00000000000000000000000000000000:0BB9 00000000000000000000000000000000:0000 0A\n",
    );
    await expect(new NodeTcpListenerReader(read).read()).resolves.toEqual({
      outcome: "observed",
      listeners: [
        { port: 3000, binding: "loopback", family: "ipv6" },
        { port: 3001, binding: "wildcard", family: "ipv6" },
      ],
    });
  });

  it("reports undetermined, and flags privilege, when every source is refused", async () => {
    const read = vi.fn(async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    await expect(new NodeTcpListenerReader(read).read()).resolves.toEqual({
      outcome: "undetermined",
      code: "listener_permission_denied",
      requiresPrivilege: true,
    });
  });

  it("reports undetermined without claiming privilege when /proc is simply absent", async () => {
    const read = vi.fn(async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    });
    await expect(new NodeTcpListenerReader(read).read()).resolves.toEqual({
      outcome: "undetermined",
      code: "listener_source_unreadable",
      requiresPrivilege: false,
    });
  });
});
