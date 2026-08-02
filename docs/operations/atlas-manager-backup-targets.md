# Atlas Manager backup targets

Backup targets are immutable, project-owned registrations. HTTP callers use a
canonical target ID and cannot provide a source path, destination, adapter, or
command.

Supported kinds are `mock` and `filesystem_tree`. The production destination
root is fixed at `/var/lib/atlas-manager-backups`. Filesystem sources are
operator configuration, must be absolute safe directories, and cannot overlap
the destination or special Linux trees.

Each target has explicit file, byte, depth, and path limits. Schedule modes are
`manual`, `scheduled`, and `disabled`; retention preserves at least the
configured number of successful artifacts.
