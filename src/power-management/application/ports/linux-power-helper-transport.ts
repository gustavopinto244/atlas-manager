import type {
  LinuxPowerHelperRequest,
  LinuxPowerHelperResponse,
} from "../../domain/linux-power-helper-protocol.js";

export interface LinuxPowerHelperTransport {
  execute(request: LinuxPowerHelperRequest): Promise<LinuxPowerHelperResponse>;
}
