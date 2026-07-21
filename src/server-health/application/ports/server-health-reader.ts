import type { ServerHealthSnapshot } from "../../domain/server-health-snapshot.js";

export interface ServerHealthReader {
  read(): Promise<ServerHealthSnapshot>;
}
