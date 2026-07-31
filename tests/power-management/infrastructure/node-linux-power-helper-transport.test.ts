/* eslint-disable @typescript-eslint/unbound-method */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createReadWakeAlarmRequest } from "../../../src/power-management/domain/linux-power-helper-protocol.js";
import { NodeLinuxPowerHelperTransport } from "../../../src/power-management/infrastructure/node-linux-power-helper-transport.js";
import {
  LINUX_POWER_HELPER_PATH,
  type LinuxPowerHelperInstallationInspector,
} from "../../../src/power-management/infrastructure/linux-power-helper-installation-inspector.js";
import { LinuxPowerHelperTransportError } from "../../../src/power-management/infrastructure/linux-power-helper-errors.js";

const request = createReadWakeAlarmRequest("2026-08-01T12:00:00.000Z");
class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killed = false;

  public readonly kill = (): boolean => {
    this.killed = true;
    return true;
  };
}

function createInspector(): LinuxPowerHelperInstallationInspector {
  return { inspect: vi.fn() };
}

describe("NodeLinuxPowerHelperTransport", () => {
  it("rejects unsupported platforms before inspecting or spawning", async () => {
    const inspector = createInspector();
    const spawnProcess = vi.fn();
    const transport = new NodeLinuxPowerHelperTransport({
      inspector,
      platform: "darwin",
      spawn: spawnProcess as never,
    });

    await expect(transport.execute(request)).rejects.toMatchObject({
      code: "unsupported_platform",
    });
    expect(inspector.inspect).not.toHaveBeenCalled();
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it("uses the fixed executable, no arguments, no shell, fixed cwd, and minimal environment", async () => {
    const child = new FakeChild();
    const spawnProcess = vi.fn(() => child);
    const transport = new NodeLinuxPowerHelperTransport({
      inspector: createInspector(),
      platform: "linux",
      spawn: spawnProcess as never,
    });
    child.stdin.on("finish", () => {
      child.stdout.end(
        '{"version":1,"operation":"read_wake_alarm","outcome":"success","result":{"state":"not_scheduled"}}\n',
      );
      child.emit("close", 0, null);
    });

    await expect(transport.execute(request)).resolves.toMatchObject({
      operation: "read_wake_alarm",
      outcome: "success",
    });
    expect(spawnProcess).toHaveBeenCalledWith(
      LINUX_POWER_HELPER_PATH,
      [],
      expect.objectContaining({
        cwd: "/",
        env: { LANG: "C", LC_ALL: "C" },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });

  it("translates nonzero exits without exposing process details", async () => {
    const child = new FakeChild();
    const transport = new NodeLinuxPowerHelperTransport({
      inspector: createInspector(),
      platform: "linux",
      spawn: vi.fn(() => child) as never,
    });
    child.stdin.on("finish", () => child.emit("close", 7, null));

    await expect(transport.execute(request)).rejects.toEqual(
      new LinuxPowerHelperTransportError("helper_exit_failed"),
    );
  });

  it("stops collecting oversized stdout and terminates the child", async () => {
    const child = new FakeChild();
    const transport = new NodeLinuxPowerHelperTransport({
      inspector: createInspector(),
      platform: "linux",
      spawn: vi.fn(() => child) as never,
    });
    child.stdin.on("finish", () => child.stdout.write("x".repeat(16_385)));

    await expect(transport.execute(request)).rejects.toMatchObject({
      code: "helper_stdout_too_large",
    });
    expect(child.killed).toBe(true);
  });

  it("serializes same-instance operations", async () => {
    const children: FakeChild[] = [];
    const spawnProcess = vi.fn(() => {
      const child = new FakeChild();
      children.push(child);
      child.stdin.on("finish", () => {
        child.stdout.end(
          '{"version":1,"operation":"read_wake_alarm","outcome":"success","result":{"state":"not_scheduled"}}\n',
        );
        child.emit("close", 0, null);
      });
      return child;
    });
    const transport = new NodeLinuxPowerHelperTransport({
      inspector: createInspector(),
      platform: "linux",
      spawn: spawnProcess as never,
    });

    await Promise.all([transport.execute(request), transport.execute(request)]);
    expect(spawnProcess).toHaveBeenCalledTimes(2);
    expect(children).toHaveLength(2);
  });
});
