export type ServiceAvailabilityPolicyTransition =
  | Readonly<{
      kind: "became_available";
      scheduledFor: string;
    }>
  | Readonly<{
      kind: "became_unavailable";
      scheduledFor: string;
    }>;
