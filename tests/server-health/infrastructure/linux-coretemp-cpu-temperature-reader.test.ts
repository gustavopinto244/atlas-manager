import { describe, expect, it, vi } from "vitest";

import {
  LinuxCoretempCpuTemperatureReader,
  parseMillidegreesCelsius,
  type HardwareMonitorFilesystem,
} from "../../../src/server-health/infrastructure/linux-coretemp-cpu-temperature-reader.js";

const hwmonRoot = "/sys/class/hwmon";

interface FilesystemFixture {
  readonly directories?: Readonly<Record<string, readonly string[]>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly failures?: Readonly<Record<string, Error>>;
}

function createFilesystem(fixture: FilesystemFixture = {}): {
  readonly filesystem: HardwareMonitorFilesystem;
  readonly listDirectory: ReturnType<typeof vi.fn>;
  readonly readTextFile: ReturnType<typeof vi.fn>;
} {
  const readFixture = <T>(
    values: Readonly<Record<string, T>> | undefined,
    path: string,
  ): T => {
    const failure = fixture.failures?.[path];

    if (failure !== undefined) {
      throw failure;
    }

    const value = values?.[path];

    if (value === undefined) {
      throw createFilesystemError("ENOENT");
    }

    return value;
  };
  const listDirectory = vi.fn((path: string) =>
    Promise.resolve(readFixture(fixture.directories, path)),
  );
  const readTextFile = vi.fn((path: string) =>
    Promise.resolve(readFixture(fixture.files, path)),
  );

  return {
    filesystem: { listDirectory, readTextFile },
    listDirectory,
    readTextFile,
  };
}

function createFilesystemError(code: string): Error & { code: string } {
  return Object.assign(new Error("filesystem operation failed"), { code });
}

function createAvailableSensorFixture(
  rawTemperature = "47250\n",
): FilesystemFixture {
  return {
    directories: {
      [hwmonRoot]: ["hwmon0", "hwmon1"],
      [`${hwmonRoot}/hwmon1`]: ["temp1_label", "temp2_label", "temp2_input"],
    },
    files: {
      [`${hwmonRoot}/hwmon0/name`]: "acpitz\n",
      [`${hwmonRoot}/hwmon1/name`]: "coretemp\n",
      [`${hwmonRoot}/hwmon1/temp1_label`]: "Core 0\n",
      [`${hwmonRoot}/hwmon1/temp2_label`]: "Package id 0\n",
      [`${hwmonRoot}/hwmon1/temp2_input`]: rawTemperature,
    },
  };
}

describe("LinuxCoretempCpuTemperatureReader", () => {
  it("discovers coretemp and converts its package reading to Celsius", async () => {
    const { filesystem, listDirectory, readTextFile } = createFilesystem(
      createAvailableSensorFixture(),
    );
    const reader = new LinuxCoretempCpuTemperatureReader(filesystem);

    await expect(reader.read()).resolves.toBe(47.25);
    expect(listDirectory).toHaveBeenNthCalledWith(1, hwmonRoot);
    expect(readTextFile).toHaveBeenCalledWith(
      `${hwmonRoot}/hwmon1/temp2_input`,
    );
  });

  it("preserves decimal Celsius values without rounding", async () => {
    const { filesystem } = createFilesystem(
      createAvailableSensorFixture("47251"),
    );

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).resolves.toBe(47.251);
  });

  it("ignores unrelated hwmon devices before selecting coretemp", async () => {
    const { filesystem, readTextFile } = createFilesystem(
      createAvailableSensorFixture(),
    );

    await new LinuxCoretempCpuTemperatureReader(filesystem).read();

    expect(readTextFile).toHaveBeenCalledWith(`${hwmonRoot}/hwmon0/name`);
    expect(readTextFile).toHaveBeenCalledWith(`${hwmonRoot}/hwmon1/name`);
  });

  it("ignores unrelated temperature labels", async () => {
    const { filesystem, readTextFile } = createFilesystem(
      createAvailableSensorFixture(),
    );

    await new LinuxCoretempCpuTemperatureReader(filesystem).read();

    expect(readTextFile).toHaveBeenCalledWith(
      `${hwmonRoot}/hwmon1/temp1_label`,
    );
    expect(readTextFile).toHaveBeenCalledWith(
      `${hwmonRoot}/hwmon1/temp2_label`,
    );
  });

  it("returns null when the hwmon directory is missing", async () => {
    const { filesystem } = createFilesystem();

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).resolves.toBeNull();
  });

  it("returns null when no exact coretemp device exists", async () => {
    const { filesystem } = createFilesystem({
      directories: { [hwmonRoot]: ["hwmon0"] },
      files: { [`${hwmonRoot}/hwmon0/name`]: "coretemp-extra" },
    });

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).resolves.toBeNull();
  });

  it("returns null when no exact package label exists", async () => {
    const { filesystem } = createFilesystem({
      directories: {
        [hwmonRoot]: ["hwmon0"],
        [`${hwmonRoot}/hwmon0`]: ["temp1_label"],
      },
      files: {
        [`${hwmonRoot}/hwmon0/name`]: "coretemp",
        [`${hwmonRoot}/hwmon0/temp1_label`]: "Package id 01",
      },
    });

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).resolves.toBeNull();
  });

  it("returns null when the sensor input disappears during discovery", async () => {
    const fixture = createAvailableSensorFixture();
    const missingInputPath = `${hwmonRoot}/hwmon1/temp2_input`;
    const { filesystem } = createFilesystem({
      ...fixture,
      failures: { [missingInputPath]: createFilesystemError("ENOENT") },
    });

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).resolves.toBeNull();
  });

  it.each([
    ["empty content", " \n"],
    ["non-numeric content", "temperature=47250"],
    ["non-integer content", "47250.5"],
    ["a value outside the safe-integer range", "9007199254740992"],
    ["a negative value", "-1000"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
  ])("rejects %s", async (_description, rawTemperature) => {
    const { filesystem } = createFilesystem(
      createAvailableSensorFixture(rawTemperature),
    );

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).rejects.toThrow("Invalid CPU temperature value");
  });

  it("propagates unexpected filesystem errors unchanged", async () => {
    const failure = createFilesystemError("EACCES");
    const { filesystem } = createFilesystem({
      failures: { [hwmonRoot]: failure },
    });

    await expect(
      new LinuxCoretempCpuTemperatureReader(filesystem).read(),
    ).rejects.toBe(failure);
  });
});

describe("parseMillidegreesCelsius", () => {
  it("converts an integer millidegree value", () => {
    expect(parseMillidegreesCelsius("47250")).toBe(47.25);
  });
});
