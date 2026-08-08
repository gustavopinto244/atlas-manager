export type AtlasCommand = Readonly<{
  path: readonly string[];
  summary: string;
  implemented: boolean;
}>;

export const ATLAS_COMMANDS: readonly AtlasCommand[] = Object.freeze([
  { path: ["status"], summary: "Show the operator status", implemented: true },
  {
    path: ["health"],
    summary: "Read Atlas health endpoints",
    implemented: true,
  },
  {
    path: ["doctor"],
    summary: "Run read-only diagnostics",
    implemented: false,
  },
  {
    path: ["services", "list"],
    summary: "List registered services",
    implemented: true,
  },
  {
    path: ["services", "status"],
    summary: "Read a service status",
    implemented: true,
  },
  {
    path: ["services", "start"],
    summary: "Start a registered service",
    implemented: false,
  },
  {
    path: ["services", "stop"],
    summary: "Stop a registered service",
    implemented: false,
  },
  {
    path: ["services", "restart"],
    summary: "Restart a registered service",
    implemented: false,
  },
  {
    path: ["services", "logs"],
    summary: "Read service logs",
    implemented: false,
  },
  {
    path: ["services", "schedule", "show"],
    summary: "Show a service schedule",
    implemented: true,
  },
  {
    path: ["services", "schedule", "preview"],
    summary: "Preview a service schedule",
    implemented: true,
  },
  {
    path: ["backups", "list"],
    summary: "List backup targets",
    implemented: false,
  },
  {
    path: ["backups", "status"],
    summary: "Show backup status",
    implemented: false,
  },
  {
    path: ["backups", "runs"],
    summary: "List backup runs",
    implemented: false,
  },
  {
    path: ["infra", "status"],
    summary: "Show infrastructure status",
    implemented: false,
  },
  {
    path: ["infra", "listeners"],
    summary: "Show expected listeners",
    implemented: false,
  },
  {
    path: ["nginx", "status"],
    summary: "Show Nginx status",
    implemented: false,
  },
  {
    path: ["nginx", "test"],
    summary: "Validate Nginx configuration",
    implemented: false,
  },
  {
    path: ["tunnel", "status"],
    summary: "Show tunnel status",
    implemented: false,
  },
  {
    path: ["events"],
    summary: "Read administrative event history",
    implemented: false,
  },
  {
    path: ["machine", "status"],
    summary: "Show machine power policy status",
    implemented: false,
  },
  {
    path: ["machine", "plan"],
    summary: "Show the machine power plan",
    implemented: false,
  },
  {
    path: ["machine", "schedule", "show"],
    summary: "Show the machine schedule",
    implemented: false,
  },
]);

export function findCommand(path: readonly string[]): AtlasCommand | undefined {
  return ATLAS_COMMANDS.find(
    (command) =>
      command.path.length === path.length &&
      command.path.every((part, index) => part === path[index]),
  );
}

export function commandPath(path: readonly string[]): string {
  return path.join(" ");
}
