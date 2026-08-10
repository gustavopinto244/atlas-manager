export type NginxConfigTestOutcome =
  | Readonly<{ outcome: "valid" }>
  | Readonly<{
      outcome: "invalid";
      /**
       * The single `nginx: [emerg] …` line only, bounded. Never the full stderr
       * blob: ADR-032 §7 keeps merged configuration content out of the payload.
       */
      detail: string;
    }>
  | Readonly<{
      outcome: "undetermined";
      code:
        | "nginx_permission_denied"
        | "nginx_unavailable"
        | "nginx_timeout"
        | "nginx_output_invalid";
      requiresPrivilege: boolean;
    }>;

export interface NginxConfigTestRunner {
  run(): Promise<NginxConfigTestOutcome>;
}
