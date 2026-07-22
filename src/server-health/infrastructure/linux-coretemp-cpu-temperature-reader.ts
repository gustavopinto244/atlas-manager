import { readdir, readFile } from "node:fs/promises";

const HWMON_DIRECTORY = "/sys/class/hwmon";
const CORETEMP_DRIVER_NAME = "coretemp";
const CPU_PACKAGE_LABEL = "Package id 0";

export interface HardwareMonitorFilesystem {
  listDirectory(path: string): Promise<readonly string[]>;
  readTextFile(path: string): Promise<string>;
}

const nodeFilesystem: HardwareMonitorFilesystem = {
  listDirectory: (path) => readdir(path),
  readTextFile: (path) => readFile(path, "utf8"),
};

export class LinuxCoretempCpuTemperatureReader {
  public constructor(
    private readonly filesystem: HardwareMonitorFilesystem = nodeFilesystem,
  ) {}

  public async read(): Promise<number | null> {
    try {
      return await this.readAvailableTemperature();
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }

      throw error;
    }
  }

  private async readAvailableTemperature(): Promise<number | null> {
    const hardwareMonitorEntries =
      await this.filesystem.listDirectory(HWMON_DIRECTORY);

    for (const entry of hardwareMonitorEntries) {
      if (!/^hwmon\d+$/.test(entry)) {
        continue;
      }

      const deviceDirectory = `${HWMON_DIRECTORY}/${entry}`;
      const driverName = (
        await this.filesystem.readTextFile(`${deviceDirectory}/name`)
      ).trim();

      if (driverName !== CORETEMP_DRIVER_NAME) {
        continue;
      }

      const temperature = await this.readCpuPackageTemperature(deviceDirectory);

      if (temperature !== null) {
        return temperature;
      }
    }

    return null;
  }

  private async readCpuPackageTemperature(
    deviceDirectory: string,
  ): Promise<number | null> {
    const deviceEntries = await this.filesystem.listDirectory(deviceDirectory);

    for (const entry of deviceEntries) {
      const labelMatch = /^temp(\d+)_label$/.exec(entry);

      if (labelMatch === null) {
        continue;
      }

      const label = (
        await this.filesystem.readTextFile(`${deviceDirectory}/${entry}`)
      ).trim();

      if (label !== CPU_PACKAGE_LABEL) {
        continue;
      }

      const sensorIndex = labelMatch[1];

      if (sensorIndex === undefined) {
        throw new Error("Invalid CPU temperature sensor entry");
      }

      const rawValue = await this.filesystem.readTextFile(
        `${deviceDirectory}/temp${sensorIndex}_input`,
      );

      return parseMillidegreesCelsius(rawValue);
    }

    return null;
  }
}

export function parseMillidegreesCelsius(rawValue: string): number {
  const trimmedValue = rawValue.trim();

  if (trimmedValue.length === 0 || !/^-?\d+$/.test(trimmedValue)) {
    throw new Error("Invalid CPU temperature value");
  }

  const millidegreesCelsius = Number(trimmedValue);

  if (!Number.isSafeInteger(millidegreesCelsius) || millidegreesCelsius < 0) {
    throw new Error("Invalid CPU temperature value");
  }

  const temperatureCelsius = millidegreesCelsius / 1_000;

  if (!Number.isFinite(temperatureCelsius)) {
    throw new Error("Invalid CPU temperature value");
  }

  return temperatureCelsius;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
