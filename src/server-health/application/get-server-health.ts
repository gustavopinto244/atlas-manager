import type { ServerHealthSnapshot } from "../domain/server-health-snapshot.js";
import type { ServerHealthReader } from "./ports/server-health-reader.js";

export class GetServerHealth {
  public constructor(private readonly reader: ServerHealthReader) {}

  public execute(): Promise<ServerHealthSnapshot> {
    return this.reader.read();
  }
}
