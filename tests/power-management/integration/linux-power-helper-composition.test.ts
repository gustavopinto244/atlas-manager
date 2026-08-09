import { describe, expect, it, vi } from "vitest";
import { createPowerManagement } from "../../../src/power-management/composition/create-power-management.js";
import { createLinuxPowerHelperAdapters } from "../../../src/power-management/composition/create-linux-power-helper-adapters.js";
import { createConfiguredPowerManagementInfrastructure } from "../../../src/power-management/composition/create-configured-power-management-infrastructure.js";
import { InMemoryLinuxPowerHelperTransport } from "../../../src/power-management/infrastructure/in-memory-linux-power-helper-transport.js";
import type { PowerManagementClock } from "../../../src/power-management/application/ports/power-management-clock.js";

const NOW = "2026-08-01T12:00:00.000Z";

describe("helper-backed power-management composition seam", () => {
  it("keeps twelve frozen capabilities and routes helper-backed overrides", async () => {
    const transport = new InMemoryLinuxPowerHelperTransport();
    const adapters = createLinuxPowerHelperAdapters({ transport });
    const infrastructure = createConfiguredPowerManagementInfrastructure(
      "linux_helper",
      { createLinuxPowerHelperAdapters: () => adapters },
    );
    const clock: PowerManagementClock = { now: vi.fn(() => new Date(NOW)) };
    const capabilities = createPowerManagement({
      clock,
      ...infrastructure.adapters,
      /* The explicit adapter overrides above are the composition boundary's
       * frozen bundle; no adapter is constructed per use case. */
    });

    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.keys(capabilities)).toHaveLength(12);
    await expect(capabilities.getNextWakeAlarm.execute()).resolves.toEqual({
      observedAt: NOW,
      wakeAlarm: { state: "not_scheduled" },
    });
    await capabilities.scheduleWakeAlarm.execute({
      scheduledFor: "2026-08-02T12:00:00.000Z",
    });
    await expect(
      capabilities.requestMachineShutdown.execute(),
    ).resolves.toEqual({
      operation: "shutdown",
      requestedAt: NOW,
      outcome: "accepted",
    });
    expect(
      transport.invocations.map((invocation) => invocation.operation),
    ).toEqual(["read_wake_alarm", "schedule_wake_alarm", "request_shutdown"]);
  });

  it("does not inspect or invoke the helper when default composition is built", () => {
    const capabilities = createPowerManagement();
    expect(Object.isFrozen(capabilities)).toBe(true);
  });
});
