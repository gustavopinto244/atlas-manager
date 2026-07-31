import type { MachinePowerSchedulerCursor } from "../../domain/machine-power-scheduler-cursor.js";
import type { MachinePowerSchedulerCursorAdvanceResult } from "../../domain/machine-power-scheduler-cursor-result.js";

export interface MachinePowerSchedulerCursorStore {
  read(): Promise<MachinePowerSchedulerCursor | null>;
  advance(
    expected: MachinePowerSchedulerCursor | null,
    next: MachinePowerSchedulerCursor,
  ): Promise<MachinePowerSchedulerCursorAdvanceResult>;
}
