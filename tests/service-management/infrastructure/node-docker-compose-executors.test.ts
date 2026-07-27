import { describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any */

import {
  NodeDockerComposeProjectStatusExecutor,
  NodeDockerComposeProjectControlExecutor,
  NodeDockerComposeProjectLogExecutor,
  NodeDockerContainerLogExecutor,
} from "../../../src/service-management/infrastructure/node-docker-compose-executors.js";

function createExecFile(): any {
  return vi.fn();
}

describe("NodeDockerComposeProjectStatusExecutor", () => {
  it("executes docker compose ps with exact arguments", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _exe: string,
        _args: string[],
        _opts: Record<string, unknown>,
        cb: (err: null, stdout: string) => void,
      ) =>
        cb(
          null,
          JSON.stringify([{ Name: "svc", State: "running", ExitCode: 0 }]),
        ),
    );
    const executor = new NodeDockerComposeProjectStatusExecutor({ execFile });

    await executor.execute("my-proj", "/srv", "/srv/compose.yaml");

    expect(execFile).toHaveBeenCalledOnce();
    const call = execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(call[0]).toBe("docker");
    expect(call[1]).toEqual([
      "compose",
      "--project-name",
      "my-proj",
      "--project-directory",
      "/srv",
      "--file",
      "/srv/compose.yaml",
      "ps",
      "--all",
      "--format",
      "json",
    ]);
    expect(call[2].shell).toBe(false);
    expect(call[2].encoding).toBe("utf8");
    expect(typeof call[2].timeout).toBe("number");
    expect(call[2].timeout).toBeGreaterThan(0);
    expect(typeof call[2].maxBuffer).toBe("number");
    expect(call[2].maxBuffer).toBeGreaterThan(0);
    expect(call[2].windowsHide).toBe(true);
  });

  it("maps ENOENT to docker not found", async () => {
    const execFile = createExecFile();
    const notFoundError = Object.assign(new Error("not found"), {
      code: "ENOENT",
    });
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: Error) => void,
      ) => cb(notFoundError),
    );
    const executor = new NodeDockerComposeProjectStatusExecutor({ execFile });

    await expect(
      executor.execute("proj", "/srv", "/srv/compose.yaml"),
    ).rejects.toThrow("Docker executable not found");
  });

  it("maps killed process to timeout", async () => {
    const execFile = createExecFile();
    const killedError = Object.assign(new Error("killed"), { killed: true });
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: Error) => void,
      ) => cb(killedError),
    );
    const executor = new NodeDockerComposeProjectStatusExecutor({ execFile });

    await expect(
      executor.execute("proj", "/srv", "/srv/compose.yaml"),
    ).rejects.toThrow();
  });
});

describe("NodeDockerComposeProjectControlExecutor", () => {
  it("executes docker compose start with exact arguments", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await executor.execute("start", "my-proj", "/srv", "/srv/compose.yaml");

    const call = execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(call[0]).toBe("docker");
    expect(call[1]).toEqual([
      "compose",
      "--project-name",
      "my-proj",
      "--project-directory",
      "/srv",
      "--file",
      "/srv/compose.yaml",
      "start",
    ]);
    expect(call[2].shell).toBe(false);
    expect(call[2].encoding).toBe("utf8");
    expect(typeof call[2].timeout).toBe("number");
    expect(call[2].timeout).toBeGreaterThan(0);
  });

  it("executes docker compose stop with exact arguments", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await executor.execute("stop", "my-proj", "/srv", "/srv/compose.yaml");

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args[args.length - 1]).toBe("stop");
  });

  it("executes docker compose restart with exact arguments", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(function (
      this: void,
      _e: string,
      _a: string[],
      _o: Record<string, unknown>,
      cb: (err: null) => void,
    ) {
      cb(null);
    });
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await executor.execute("restart", "my-proj", "/srv", "/srv/compose.yaml");

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args[args.length - 1]).toBe("restart");
  });

  it("does not use 'up' for start", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await executor.execute("start", "proj", "/srv", "/srv/compose.yaml");

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args).not.toContain("up");
  });

  it("does not use 'down' for stop", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await executor.execute("stop", "proj", "/srv", "/srv/compose.yaml");

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args).not.toContain("down");
  });

  it("passes compose file and project directory as separate arguments", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await executor.execute("start", "proj", "/srv", "/srv/compose.yaml");

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    const fileIdx = args.indexOf("--file");
    const dirIdx = args.indexOf("--project-directory");
    expect(fileIdx).toBeGreaterThan(-1);
    expect(dirIdx).toBeGreaterThan(-1);
    expect(args[fileIdx + 1]).toBe("/srv/compose.yaml");
    expect(args[dirIdx + 1]).toBe("/srv");
  });

  it("maps command failure for control operations", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: Error) => void,
      ) => cb(new Error("command failed")),
    );
    const executor = new NodeDockerComposeProjectControlExecutor({ execFile });

    await expect(
      executor.execute("start", "proj", "/srv", "/srv/compose.yaml"),
    ).rejects.toThrow();
  });
});

describe("NodeDockerComposeProjectLogExecutor", () => {
  it("executes docker compose logs with tail and timestamps", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null, stdout: string) => void,
      ) => cb(null, "log1"),
    );
    const executor = new NodeDockerComposeProjectLogExecutor({ execFile });

    const result = await executor.execute(
      "proj",
      "/srv",
      "/srv/compose.yaml",
      50,
    );

    const call = execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(call[0]).toBe("docker");
    expect(call[1]).toEqual([
      "compose",
      "--project-name",
      "proj",
      "--project-directory",
      "/srv",
      "--file",
      "/srv/compose.yaml",
      "logs",
      "--no-color",
      "--timestamps",
      "--tail",
      "50",
    ]);
    expect(call[2].shell).toBe(false);
    expect(typeof call[2].timeout).toBe("number");
    expect(call[2].timeout).toBeGreaterThan(0);
    expect(result.stdout).toBe("log1");
  });

  it("uses --no-color and --timestamps", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectLogExecutor({ execFile });

    await executor.execute("proj", "/srv", "/srv/compose.yaml", 10);

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args).toContain("--no-color");
    expect(args).toContain("--timestamps");
    expect(args).toContain("--tail");
    expect(args).toContain("10");
  });

  it("does not use --follow", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerComposeProjectLogExecutor({ execFile });

    await executor.execute("proj", "/srv", "/srv/compose.yaml", 10);

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args).not.toContain("--follow");
    expect(args).not.toContain("-f");
  });
});

describe("NodeDockerContainerLogExecutor", () => {
  it("executes docker container logs with exact arguments", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null, stdout: string) => void,
      ) => cb(null, "log1"),
    );
    const executor = new NodeDockerContainerLogExecutor({ execFile });

    const result = await executor.execute("my-container", 25);

    const call = execFile.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(call[0]).toBe("docker");
    expect(call[1]).toEqual([
      "container",
      "logs",
      "--timestamps",
      "--tail",
      "25",
      "my-container",
    ]);
    expect(call[2].shell).toBe(false);
    expect(result.stdout).toBe("log1");
  });

  it("passes container target as one argument", async () => {
    const execFile = createExecFile();
    execFile.mockImplementation(
      (
        _e: string,
        _a: string[],
        _o: Record<string, unknown>,
        cb: (err: null) => void,
      ) => cb(null),
    );
    const executor = new NodeDockerContainerLogExecutor({ execFile });

    await executor.execute("container-name with spaces", 10);

    const args = (execFile.mock.calls[0] as [string, string[]])[1];
    expect(args[args.length - 1]).toBe("container-name with spaces");
    expect(args).not.toContain("--follow");
  });
});
