import { describe, expect, it, vi } from "vitest";

import {
  decideServiceAvailabilityReconciliation,
  ServiceAvailabilityReconciliationDecisionError,
} from "../../../src/service-management/domain/service-availability-reconciliation-decision.js";
import type { ServiceRuntimeState } from "../../../src/service-management/domain/registered-service-status.js";
import type { ServiceAvailabilityExpectation } from "../../../src/service-scheduling/domain/service-availability-policy-evaluator.js";

type MatrixRow = readonly [
  ServiceAvailabilityExpectation,
  ServiceRuntimeState,
  (
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "execute"; operation: "start" | "stop" }>
  ),
];

const decisionMatrix = [
  ["available", "running", { kind: "none" }],
  ["available", "stopped", { kind: "execute", operation: "start" }],
  ["available", "failed", { kind: "none" }],
  ["available", "unknown", { kind: "none" }],
  ["unavailable", "running", { kind: "execute", operation: "stop" }],
  ["unavailable", "stopped", { kind: "none" }],
  ["unavailable", "failed", { kind: "none" }],
  ["unavailable", "unknown", { kind: "none" }],
  ["manual", "running", { kind: "none" }],
  ["manual", "stopped", { kind: "none" }],
  ["manual", "failed", { kind: "none" }],
  ["manual", "unknown", { kind: "none" }],
  ["disabled", "running", { kind: "none" }],
  ["disabled", "stopped", { kind: "none" }],
  ["disabled", "failed", { kind: "none" }],
  ["disabled", "unknown", { kind: "none" }],
] as const satisfies readonly MatrixRow[];

function expectSafeInvalidInput(
  action: () => unknown,
): ServiceAvailabilityReconciliationDecisionError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(
      ServiceAvailabilityReconciliationDecisionError,
    );
    expect(error).toEqual(
      expect.objectContaining({
        name: "ServiceAvailabilityReconciliationDecisionError",
        code: "invalid_service_availability_reconciliation_input",
        message: "Invalid service availability reconciliation input",
      }),
    );
    expect(error).not.toHaveProperty("cause");
    return error as ServiceAvailabilityReconciliationDecisionError;
  }

  throw new Error("Expected reconciliation input validation to fail");
}

describe("decideServiceAvailabilityReconciliation", () => {
  it.each(decisionMatrix)(
    "maps %s + %s to the canonical decision",
    (expectation, runtimeState, expected) => {
      const decision = decideServiceAvailabilityReconciliation(
        expectation,
        runtimeState,
      );

      expect(decision).toEqual(expected);
      expect(Object.keys(decision)).toEqual(Object.keys(expected));
      expect(Object.isFrozen(decision)).toBe(true);
      expect(decision).not.toHaveProperty("serviceId");
      expect(decision).not.toHaveProperty("expectation");
      expect(decision).not.toHaveProperty("runtimeState");
      expect(decision).not.toHaveProperty("reason");
      expect(decision).not.toHaveProperty("operation", "restart");
    },
  );

  it.each([
    ["available", "stopped", "start"],
    ["unavailable", "running", "stop"],
  ] as const)(
    "returns an immutable execute %s decision",
    (expectation, runtimeState, operation) => {
      const decision = decideServiceAvailabilityReconciliation(
        expectation,
        runtimeState,
      );

      expect(decision).toEqual({ kind: "execute", operation });
      expect(Object.keys(decision)).toEqual(["kind", "operation"]);
      expect(() => {
        (
          decision as {
            operation: "start" | "stop";
          }
        ).operation = operation === "start" ? "stop" : "start";
      }).toThrow(TypeError);
      expect(() => {
        Object.assign(decision, { serviceId: "private-service" });
      }).toThrow(TypeError);
      expect(() => {
        delete (decision as { operation?: "start" | "stop" }).operation;
      }).toThrow(TypeError);
    },
  );

  it("returns an immutable explicit none decision", () => {
    const decision = decideServiceAvailabilityReconciliation(
      "available",
      "running",
    );

    expect(decision).toEqual({ kind: "none" });
    expect(Object.keys(decision)).toEqual(["kind"]);
    expect(decision).not.toHaveProperty("operation");
    expect(() => {
      Object.assign(decision, { operation: "start" });
    }).toThrow(TypeError);
    expect(() => {
      delete (decision as { kind?: "none" }).kind;
    }).toThrow(TypeError);
  });

  it.each([
    "Available",
    "AVAILABLE",
    " available",
    "available ",
    "enabled",
    "offline",
    "on",
    "off",
    "",
    " ",
    undefined,
    null,
    true,
    false,
    0,
    1,
    {},
    [],
    new String("available"),
    Symbol("available"),
  ])("rejects invalid expectation input %#", (expectation) => {
    expectSafeInvalidInput(() =>
      decideServiceAvailabilityReconciliation(expectation, "running"),
    );
  });

  it.each([
    "Running",
    "RUNNING",
    " running",
    "stopped ",
    "starting",
    "stopping",
    "inactive",
    "online",
    "offline",
    "crashed",
    "",
    " ",
    undefined,
    null,
    true,
    false,
    0,
    1,
    {},
    [],
    new String("running"),
  ])("rejects invalid runtime-state input %#", (runtimeState) => {
    expectSafeInvalidInput(() =>
      decideServiceAvailabilityReconciliation("available", runtimeState),
    );
  });

  it("does not expose rejected sentinel values through errors", () => {
    const expectationSentinel = "private-expectation-sentinel";
    const runtimeStateSentinel = "private-runtime-state-sentinel";
    const error = expectSafeInvalidInput(() =>
      decideServiceAvailabilityReconciliation(
        expectationSentinel,
        runtimeStateSentinel,
      ),
    );
    const serialized = JSON.stringify(error);

    expect(error.message).not.toContain(expectationSentinel);
    expect(error.message).not.toContain(runtimeStateSentinel);
    expect(error.code).not.toContain(expectationSentinel);
    expect(error.code).not.toContain(runtimeStateSentinel);
    expect(serialized).not.toContain(expectationSentinel);
    expect(serialized).not.toContain(runtimeStateSentinel);
    expect(Object.keys(error)).toEqual(["name", "code"]);
  });

  it("is deterministic and never returns restart", () => {
    for (const [expectation, runtimeState, expected] of decisionMatrix) {
      const first = decideServiceAvailabilityReconciliation(
        expectation,
        runtimeState,
      );
      const second = decideServiceAvailabilityReconciliation(
        expectation,
        runtimeState,
      );

      expect(first).toEqual(expected);
      expect(second).toEqual(expected);
      expect(first).not.toHaveProperty("operation", "restart");
      expect(second).not.toHaveProperty("operation", "restart");
    }
  });

  it("has no clock, timer, environment, listener, or logging side effects", () => {
    const dateNow = vi.spyOn(Date, "now");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const processOn = vi.spyOn(process, "on");
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    decideServiceAvailabilityReconciliation("available", "stopped");
    decideServiceAvailabilityReconciliation("unavailable", "running");
    decideServiceAvailabilityReconciliation("manual", "unknown");

    expect(dateNow).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(processOn).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();

    dateNow.mockRestore();
    setTimeoutSpy.mockRestore();
    processOn.mockRestore();
    consoleLog.mockRestore();
  });
});
