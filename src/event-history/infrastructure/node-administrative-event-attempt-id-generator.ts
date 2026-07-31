import { randomUUID } from "node:crypto";
import type { AdministrativeEventAttemptIdGenerator } from "../application/ports/administrative-event-attempt-id-generator.js";

export class NodeAdministrativeEventAttemptIdGenerator implements AdministrativeEventAttemptIdGenerator {
  public generate(): string {
    return randomUUID();
  }
}
