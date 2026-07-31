import type {
  AdministrativeEvent,
  AdministrativeEventInput,
} from "../../domain/administrative-event.js";

export interface AdministrativeEventRecorder {
  record(input: AdministrativeEventInput): Promise<AdministrativeEvent>;
}
