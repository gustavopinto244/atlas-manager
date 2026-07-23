import { describe, expect, it, vi } from "vitest";

import {
  NodePm2ProcessListExecutor,
  type Pm2ExecFile,
} from "../../../src/service-management/infrastructure/pm2-process-list-executor.js";

describe("NodePm2ProcessListExecutor", () => {
  it("executes only the fixed bounded PM2 process-list operation", async () => {
    const runFile = vi
      .fn<Pm2ExecFile>()
      .mockResolvedValue('[{"name":"service"}]');
    const executor = new NodePm2ProcessListExecutor(runFile);

    await expect(executor.execute()).resolves.toBe('[{"name":"service"}]');
    expect(runFile).toHaveBeenCalledExactlyOnceWith("pm2", ["jlist"], {
      encoding: "utf8",
      maxBuffer: 1_048_576,
      shell: false,
      timeout: 5_000,
      windowsHide: true,
    });

    const invocation = JSON.stringify(runFile.mock.calls);
    expect(invocation).not.toContain("atlas-service-id");
    expect(invocation).not.toContain("external-pm2-resource");
  });

  it.each([
    ["a process-spawn failure", new Error("spawn failure")],
    ["a non-zero exit", Object.assign(new Error("exit failure"), { code: 1 })],
  ])("translates %s into a safe command error", async (_description, error) => {
    const sensitiveDetail = "credential at C:\\private\\pm2-path";
    const runFile = vi
      .fn<Pm2ExecFile>()
      .mockRejectedValue(Object.assign(error, { stderr: sensitiveDetail }));
    const executor = new NodePm2ProcessListExecutor(runFile);

    await expect(executor.execute()).rejects.toEqual(
      expect.objectContaining({
        name: "Pm2ServiceStatusReaderError",
        code: "pm2_status_command_failed",
        message: "PM2 service status error: pm2_status_command_failed",
      }),
    );

    try {
      await executor.execute();
    } catch (translatedError) {
      expect(String(translatedError)).not.toContain(sensitiveDetail);
      expect(String(translatedError)).not.toContain("jlist");
      expect(String(translatedError)).not.toContain("C:\\private");
    }
  });

  it("translates a timeout into a safe timeout error", async () => {
    const runFile = vi.fn<Pm2ExecFile>().mockRejectedValue({
      killed: true,
      signal: "SIGTERM",
      message: "timed out while running secret command",
    });
    const executor = new NodePm2ProcessListExecutor(runFile);

    await expect(executor.execute()).rejects.toEqual(
      expect.objectContaining({ code: "pm2_status_timeout" }),
    );
  });

  it("translates bounded-output failure into a safe output error", async () => {
    const runFile = vi.fn<Pm2ExecFile>().mockRejectedValue({
      code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
      stdout: "raw process output",
    });
    const executor = new NodePm2ProcessListExecutor(runFile);

    await expect(executor.execute()).rejects.toEqual(
      expect.objectContaining({ code: "pm2_status_output_invalid" }),
    );

    try {
      await executor.execute();
    } catch (translatedError) {
      expect(String(translatedError)).not.toContain("raw process output");
    }
  });
});
