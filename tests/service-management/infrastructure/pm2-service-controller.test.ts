import { describe, expect, it, vi } from "vitest";

import { ControlRegisteredService } from "../../../src/service-management/application/control-registered-service.js";
import type { RegisteredServiceCatalog } from "../../../src/service-management/application/ports/registered-service-catalog.js";
import type { ServiceControlOperation } from "../../../src/service-management/domain/registered-service-control-result.js";
import { RegisteredService } from "../../../src/service-management/domain/registered-service.js";
import type { Pm2ProcessListExecutor } from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";
import { Pm2ServiceStatusReaderError } from "../../../src/service-management/infrastructure/pm2-service-status-reader-error.js";
import type { Pm2ServiceControlExecutor } from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";
import { Pm2ServiceController } from "../../../src/service-management/infrastructure/pm2-service-controller.js";
import { Pm2ServiceControllerError } from "../../../src/service-management/infrastructure/pm2-service-controller-error.js";

const completedAt = "2026-07-24T18:00:00.000Z";

function createService(
  externalResourceId = "atlas-api-process",
  managementAdapter: "mock" | "pm2" = "pm2",
  supportedOperations: readonly string[] = [
    "readStatus",
    "start",
    "stop",
    "restart",
  ],
): RegisteredService {
  return RegisteredService.create({
    id: "stable-atlas-service",
    displayName: "Atlas API",
    managementAdapter,
    externalResourceId,
    supportedOperations,
  });
}

function processEntry(
  name: unknown,
  processId: unknown,
): Record<string, unknown> {
  return {
    name,
    pm_id: processId,
    pid: 8_421,
    monit: { cpu: 83, memory: 1_000_000 },
    pm2_env: {
      status: "online",
      pm_cwd: "/private/application",
      pm_out_log_path: "/private/logs/output.log",
      secret: "credential-value",
    },
  };
}

function createProcessListExecutor(output: string): Pm2ProcessListExecutor & {
  readonly execute: ReturnType<typeof vi.fn<Pm2ProcessListExecutor["execute"]>>;
} {
  return {
    execute: vi
      .fn<Pm2ProcessListExecutor["execute"]>()
      .mockResolvedValue(output),
  };
}

function createControlExecutor(): Pm2ServiceControlExecutor & {
  readonly execute: ReturnType<
    typeof vi.fn<Pm2ServiceControlExecutor["execute"]>
  >;
} {
  return {
    execute: vi.fn<Pm2ServiceControlExecutor["execute"]>().mockResolvedValue(),
  };
}

function createController(
  output = JSON.stringify([processEntry("atlas-api-process", 42)]),
): {
  readonly controller: Pm2ServiceController;
  readonly processListExecutor: ReturnType<typeof createProcessListExecutor>;
  readonly controlExecutor: ReturnType<typeof createControlExecutor>;
} {
  const processListExecutor = createProcessListExecutor(output);
  const controlExecutor = createControlExecutor();

  return {
    controller: new Pm2ServiceController(processListExecutor, controlExecutor),
    processListExecutor,
    controlExecutor,
  };
}

describe("Pm2ServiceController", () => {
  it.each(["start", "stop", "restart"] as const)(
    "resolves the target and delegates PM2 %s by internal ID",
    async (operation) => {
      const service = createService();
      const { controller, processListExecutor, controlExecutor } =
        createController();

      await expect(
        controller.execute(service, operation),
      ).resolves.toBeUndefined();
      expect(processListExecutor.execute).toHaveBeenCalledOnce();
      expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
        operation,
        42,
      );
      expect(
        processListExecutor.execute.mock.invocationCallOrder[0],
      ).toBeLessThan(controlExecutor.execute.mock.invocationCallOrder[0] ?? 0);
      expect(JSON.stringify(controlExecutor.execute.mock.calls)).not.toContain(
        service.id,
      );
      expect(JSON.stringify(controlExecutor.execute.mock.calls)).not.toContain(
        service.externalResourceId,
      );
    },
  );

  it("rejects a mock service before either PM2 executor", async () => {
    const service = createService("mock-target", "mock");
    const { controller, processListExecutor, controlExecutor } =
      createController();

    await expect(controller.execute(service, "start")).rejects.toEqual(
      expect.objectContaining({ code: "unsupported_control_adapter" }),
    );
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();

    try {
      await controller.execute(service, "start");
      expect.unreachable("Expected unsupported PM2 control adapter");
    } catch (error) {
      const exposedError = `${String(error)} ${JSON.stringify(error)}`;

      expect(exposedError).not.toContain(service.id);
      expect(exposedError).not.toContain(service.externalResourceId);
      expect(exposedError).not.toContain(service.displayName);
    }
  });

  it.each(["readStatus", "reload", "delete"])(
    "rejects runtime-invalid operation %s before either PM2 executor",
    async (operation) => {
      const { controller, processListExecutor, controlExecutor } =
        createController();

      await expect(
        controller.execute(
          createService(),
          operation as ServiceControlOperation,
        ),
      ).rejects.toEqual(
        expect.objectContaining({ code: "pm2_control_operation_invalid" }),
      );
      expect(processListExecutor.execute).not.toHaveBeenCalled();
      expect(controlExecutor.execute).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["an empty list", "[]"],
    [
      "a missing exact target",
      JSON.stringify([processEntry("unrelated-process", 1)]),
    ],
    [
      "a case-only variation",
      JSON.stringify([processEntry("ATLAS-API-PROCESS", 1)]),
    ],
    [
      "leading whitespace",
      JSON.stringify([processEntry(" atlas-api-process", 1)]),
    ],
    [
      "trailing whitespace",
      JSON.stringify([processEntry("atlas-api-process ", 1)]),
    ],
    ["a partial name", JSON.stringify([processEntry("atlas-api", 1)])],
    [
      "the stable Atlas service ID",
      JSON.stringify([processEntry("stable-atlas-service", 1)]),
    ],
    [
      "the first unrelated process",
      JSON.stringify([
        processEntry("first-process", 1),
        processEntry("second-process", 2),
      ]),
    ],
    [
      "a numeric-looking external resource ID",
      JSON.stringify([processEntry("other-process", 42)]),
      "42",
    ],
  ])(
    "rejects %s without fallback",
    async (_description, output, externalResourceId?: string) => {
      const { controller, controlExecutor } = createController(output);

      await expect(
        controller.execute(
          createService(externalResourceId ?? "atlas-api-process"),
          "start",
        ),
      ).rejects.toEqual(
        expect.objectContaining({ code: "pm2_control_target_not_found" }),
      );
      expect(controlExecutor.execute).not.toHaveBeenCalled();
    },
  );

  it("matches an exact target in a later entry", async () => {
    const output = JSON.stringify([
      processEntry("unrelated-process", 1),
      processEntry("atlas-api-process", 7),
    ]);
    const { controller, controlExecutor } = createController(output);

    await controller.execute(createService(), "restart");

    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      7,
    );
  });

  it("rejects duplicate exact target names", async () => {
    const output = JSON.stringify([
      processEntry("atlas-api-process", 1),
      processEntry("atlas-api-process", 2),
    ]);
    const { controller, controlExecutor } = createController(output);

    await expect(controller.execute(createService(), "stop")).rejects.toEqual(
      expect.objectContaining({ code: "duplicate_pm2_control_target" }),
    );
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "not-json"],
    ["object top-level JSON", JSON.stringify({ processes: [] })],
    ["null top-level JSON", "null"],
    ["string top-level JSON", JSON.stringify("processes")],
    ["numeric top-level JSON", "42"],
    ["a non-object entry", JSON.stringify(["process"])],
    ["an entry without a name", JSON.stringify([{ pm_id: 1 }])],
    ["a non-string name", JSON.stringify([processEntry(42, 1)])],
    ["a JSON NaN ID", '[{"name":"atlas-api-process","pm_id":NaN}]'],
  ])("rejects %s as an invalid process list", async (_description, output) => {
    const { controller, controlExecutor } = createController(output);

    await expect(controller.execute(createService(), "start")).rejects.toEqual(
      expect.objectContaining({ code: "pm2_control_process_list_invalid" }),
    );
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing ID", JSON.stringify([{ name: "atlas-api-process" }])],
    ["a null ID", JSON.stringify([processEntry("atlas-api-process", null)])],
    ["a string ID", JSON.stringify([processEntry("atlas-api-process", "1")])],
    ["a negative ID", JSON.stringify([processEntry("atlas-api-process", -1)])],
    ["a decimal ID", JSON.stringify([processEntry("atlas-api-process", 1.5)])],
    ["positive infinity", '[{"name":"atlas-api-process","pm_id":1e400}]'],
    ["negative infinity", '[{"name":"atlas-api-process","pm_id":-1e400}]'],
    [
      "an unsafe integer",
      JSON.stringify([
        processEntry("atlas-api-process", 9_007_199_254_740_992),
      ]),
    ],
  ])("rejects %s as an invalid target", async (_description, output) => {
    const { controller, controlExecutor } = createController(output);

    await expect(
      controller.execute(createService(), "restart"),
    ).rejects.toEqual(
      expect.objectContaining({ code: "pm2_control_target_invalid" }),
    );
    expect(controlExecutor.execute).not.toHaveBeenCalled();
  });

  it.each([0, 7])("accepts the valid PM2 ID %s", async (processId) => {
    const output = JSON.stringify([
      processEntry("atlas-api-process", processId),
    ]);
    const { controller, controlExecutor } = createController(output);

    await controller.execute(createService(), "stop");

    expect(controlExecutor.execute).toHaveBeenCalledWith("stop", processId);
  });

  it("discards unrelated PM2 metadata before control execution", async () => {
    const sensitiveOutput = JSON.stringify([
      processEntry("atlas-api-process", 42),
    ]);
    const { controller, controlExecutor } = createController(sensitiveOutput);

    await expect(
      controller.execute(createService(), "start"),
    ).resolves.toBeUndefined();

    const delegatedValues = JSON.stringify(controlExecutor.execute.mock.calls);

    expect(delegatedValues).toBe('[["start",42]]');
    expect(delegatedValues).not.toContain("8421");
    expect(delegatedValues).not.toContain("/private");
    expect(delegatedValues).not.toContain("credential-value");
    expect(delegatedValues).not.toContain("online");
  });

  it.each([
    [
      "a process-list timeout",
      new Pm2ServiceStatusReaderError("pm2_status_timeout"),
      "pm2_control_timeout",
    ],
    [
      "another process-list execution failure",
      new Pm2ServiceStatusReaderError("pm2_status_command_failed"),
      "pm2_control_command_failed",
    ],
    [
      "an unexpected process-list failure",
      new Error("private infrastructure failure"),
      "pm2_control_command_failed",
    ],
  ])(
    "translates %s without executing control",
    async (_description, failure, expectedCode) => {
      const { controller, processListExecutor, controlExecutor } =
        createController();
      processListExecutor.execute.mockRejectedValue(failure);

      await expect(
        controller.execute(createService(), "start"),
      ).rejects.toEqual(expect.objectContaining({ code: expectedCode }));
      expect(controlExecutor.execute).not.toHaveBeenCalled();
    },
  );

  it("propagates safe control-executor errors unchanged", async () => {
    const failure = new Pm2ServiceControllerError("pm2_control_timeout");
    const { controller, controlExecutor } = createController();
    controlExecutor.execute.mockRejectedValue(failure);

    await expect(controller.execute(createService(), "restart")).rejects.toBe(
      failure,
    );
  });

  it("does not expose service or PM2 details in controller errors", async () => {
    const service = createService();
    const sensitiveOutput = JSON.stringify([
      {
        ...processEntry(service.externalResourceId, "private-invalid-id"),
        script: "/private/application/server.js",
        log: "/private/logs/output.log",
      },
    ]);
    const { controller } = createController(sensitiveOutput);

    try {
      await controller.execute(service, "start");
      expect.unreachable("Expected invalid PM2 target");
    } catch (error) {
      const exposedError = `${String(error)} ${JSON.stringify(error)}`;

      for (const sensitiveValue of [
        service.id,
        service.externalResourceId,
        service.displayName,
        "private-invalid-id",
        "/private/application/server.js",
        "/private/logs/output.log",
        "credential-value",
        sensitiveOutput,
      ]) {
        expect(exposedError).not.toContain(sensitiveValue);
      }
      expect(error).not.toHaveProperty("cause");
    }
  });
});

describe("ControlRegisteredService with PM2 controller", () => {
  it("produces the safe application result after PM2 control succeeds", async () => {
    const service = createService("atlas-api-process", "pm2", [
      "readStatus",
      "restart",
    ]);
    const findById = vi.fn().mockResolvedValue(service);
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById,
    };
    const { controller, processListExecutor, controlExecutor } =
      createController();
    const clock = { now: vi.fn(() => new Date(completedAt)) };
    const controlService = new ControlRegisteredService(
      catalog,
      controller,
      clock,
    );

    await expect(
      controlService.execute(service.id, "restart"),
    ).resolves.toEqual({
      serviceId: service.id,
      operation: "restart",
      completedAt,
    });
    expect(findById).toHaveBeenCalledExactlyOnceWith(service.id);
    expect(processListExecutor.execute).toHaveBeenCalledOnce();
    expect(controlExecutor.execute).toHaveBeenCalledExactlyOnceWith(
      "restart",
      42,
    );
    expect(clock.now).toHaveBeenCalledOnce();
    expect(controlExecutor.execute.mock.invocationCallOrder[0]).toBeLessThan(
      clock.now.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("blocks unsupported registered operations before PM2 access", async () => {
    const service = createService("atlas-api-process", "pm2", ["readStatus"]);
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const { controller, processListExecutor, controlExecutor } =
      createController();
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      catalog,
      controller,
      clock,
    );

    await expect(controlService.execute(service.id, "start")).rejects.toEqual(
      expect.objectContaining({ code: "service_operation_not_supported" }),
    );
    expect(processListExecutor.execute).not.toHaveBeenCalled();
    expect(controlExecutor.execute).not.toHaveBeenCalled();
    expect(clock.now).not.toHaveBeenCalled();
  });

  it("does not create a result or timestamp after PM2 failure", async () => {
    const service = createService("missing-process", "pm2", [
      "readStatus",
      "stop",
    ]);
    const catalog: RegisteredServiceCatalog = {
      list: vi.fn(),
      findById: vi.fn().mockResolvedValue(service),
    };
    const { controller } = createController("[]");
    const clock = { now: vi.fn() };
    const controlService = new ControlRegisteredService(
      catalog,
      controller,
      clock,
    );

    await expect(controlService.execute(service.id, "stop")).rejects.toEqual(
      expect.objectContaining({ code: "pm2_control_target_not_found" }),
    );
    expect(clock.now).not.toHaveBeenCalled();
  });
});
