export type TcpListenerBinding = "loopback" | "wildcard" | "specific";

export type TcpListenerObservation = Readonly<{
  port: number;
  binding: TcpListenerBinding;
  family: "ipv4" | "ipv6";
}>;

export type TcpListenerOutcome =
  | Readonly<{
      outcome: "observed";
      listeners: readonly TcpListenerObservation[];
    }>
  | Readonly<{
      outcome: "undetermined";
      code: "listener_source_unreadable" | "listener_permission_denied";
      requiresPrivilege: boolean;
    }>;

export interface TcpListenerReader {
  read(): Promise<TcpListenerOutcome>;
}
