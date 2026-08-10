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
    implemented: true,
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
    implemented: true,
  },
  {
    path: ["services", "stop"],
    summary: "Stop a registered service",
    implemented: true,
  },
  {
    path: ["services", "restart"],
    summary: "Restart a registered service",
    implemented: true,
  },
  {
    path: ["services", "logs"],
    summary: "Read service logs",
    implemented: true,
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
    path: ["services", "schedule", "set"],
    summary: "Set a service schedule policy",
    implemented: true,
  },
  {
    path: ["services", "schedule", "always"],
    summary: "Set a service to always available",
    implemented: true,
  },
  {
    path: ["services", "schedule", "manual"],
    summary: "Set a service to manual availability",
    implemented: true,
  },
  {
    path: ["services", "schedule", "disable"],
    summary: "Set a service schedule to disabled",
    implemented: true,
  },
  {
    path: ["services", "schedule", "remove"],
    summary: "Remove a stored service schedule override",
    implemented: true,
  },
  {
    path: ["backups", "list"],
    summary: "List backup targets",
    implemented: true,
  },
  {
    path: ["backups", "status"],
    summary: "Show backup status",
    implemented: true,
  },
  {
    path: ["backups", "runs"],
    summary: "List backup runs",
    implemented: true,
  },
  {
    path: ["backups", "run"],
    summary: "Run a registered backup target now",
    implemented: true,
  },
  {
    path: ["backups", "run-status"],
    summary: "Read a single backup run",
    implemented: true,
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
    implemented: true,
  },
  {
    path: ["machine", "status"],
    summary: "Show machine power policy status",
    implemented: true,
  },
  {
    path: ["machine", "plan"],
    summary: "Show the machine power plan",
    implemented: true,
  },
  {
    path: ["machine", "schedule", "show"],
    summary: "Show the machine schedule",
    implemented: true,
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
