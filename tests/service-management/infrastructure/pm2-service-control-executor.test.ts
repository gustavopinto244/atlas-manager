import { describe, expect, it, vi } from "vitest";

import type { ServiceControlOperation } from "../../../src/service-management/domain/registered-service-control-result.js";
import {
  NodePm2ServiceControlExecutor,
  type Pm2ControlExecFile,
} from "../../../src/service-management/infrastructure/pm2-service-control-executor.js";

describe("NodePm2ServiceControlExecutor", () => {
  it.each(["start", "stop", "restart"] as const)(
    "executes only fixed bounded PM2 %s control by validated ID",
    async (operation) => {
      const runFile = vi.fn<Pm2ControlExecFile>().mockResolvedValue();
      const executor = new NodePm2ServiceControlExecutor(runFile);

      await expect(executor.execute(operation, 42)).resolves.toBeUndefined();
      expect(runFile).toHaveBeenCalledExactlyOnceWith(
        "pm2",
        [operation, "42"],
        {
          encoding: "utf8",
          maxBuffer: 1_048_576,
          shell: false,
          timeout: 5_000,
          windowsHide: true,
        },
      );

      const invocation = JSON.stringify(runFile.mock.calls);
      expect(invocation).not.toContain("atlas-service-id");
      expect(invocation).not.toContain("external-pm2-resource");
      expect(invocation).not.toContain("all");
      expect(invocation).not.toContain("ecosystem");
      expect(invocation).not.toContain("namespace");
    },
  );

  it("converts a zero PM2 ID to its canonical decimal argument", async () => {
    const runFile = vi.fn<Pm2ControlExecFile>().mockResolvedValue();
    const executor = new NodePm2ServiceControlExecutor(runFile);

    await executor.execute("start", 0);

    expect(runFile).toHaveBeenCalledWith(
      "pm2",
      ["start", "0"],
      expect.anything(),
    );
  });

  it.each(["readStatus", "reload", "delete", "logs"])(
    "rejects runtime-invalid operation %s before process execution",
    async (operation) => {
      const runFile = vi.fn<Pm2ControlExecFile>();
      const executor = new NodePm2ServiceControlExecutor(runFile);

      await expect(
        executor.execute(operation as ServiceControlOperation, 42),
      ).rejects.toEqual(
        expect.objectContaining({ code: "pm2_control_command_failed" }),
      );
      expect(runFile).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 1.5, Number.NaN, Infinity, -Infinity, 9_007_199_254_740_992])(
    "rejects invalid PM2 ID %s before process execution",
    async (processId) => {
      const runFile = vi.fn<Pm2ControlExecFile>();
      const executor = new NodePm2ServiceControlExecutor(runFile);

      await expect(executor.execute("stop", processId)).rejects.toEqual(
        expect.objectContaining({ code: "pm2_control_command_failed" }),
      );
      expect(runFile).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["a spawn failure", new Error("spawn failure")],
    ["a non-zero exit", Object.assign(new Error("exit failure"), { code: 1 })],
    [
      "an output-buffer failure",
      {
        code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        stdout: "private stdout",
        stderr: "private stderr",
      },
    ],
  ])("translates %s into a safe command error", async (_description, error) => {
    const runFile = vi.fn<Pm2ControlExecFile>().mockRejectedValue(error);
    const executor = new NodePm2ServiceControlExecutor(runFile);

    await expect(executor.execute("restart", 8421)).rejects.toEqual(
      expect.objectContaining({
        name: "Pm2ServiceControllerError",
        code: "pm2_control_command_failed",
        message: "PM2 service control error: pm2_control_command_failed",
      }),
    );

    try {
      await executor.execute("restart", 8421);
    } catch (translatedError) {
      const exposedError = `${String(translatedError)} ${JSON.stringify(
        translatedError,
      )}`;

      expect(exposedError).not.toContain("private stdout");
      expect(exposedError).not.toContain("private stderr");
      expect(exposedError).not.toContain("restart");
      expect(exposedError).not.toContain("8421");
      expect(translatedError).not.toHaveProperty("cause");
    }
  });

  it("translates a timeout into a safe timeout error", async () => {
    const runFile = vi.fn<Pm2ControlExecFile>().mockRejectedValue({
      killed: true,
      signal: "SIGTERM",
      message: "private timed-out command",
    });
    const executor = new NodePm2ServiceControlExecutor(runFile);

    await expect(executor.execute("start", 42)).rejects.toEqual(
      expect.objectContaining({ code: "pm2_control_timeout" }),
    );
  });
});
