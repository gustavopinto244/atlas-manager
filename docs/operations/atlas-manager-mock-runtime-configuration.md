# Atlas Manager mock runtime configuration

This operator boundary manages only
`/etc/atlas-manager/atlas-manager.env` and its private state. It supports:

```text
atlas-manager-runtime-configuration inspect
atlas-manager-runtime-configuration install-mock confirm_atlas_manager_mock_runtime_configuration
atlas-manager-runtime-configuration verify-mock
atlas-manager-runtime-configuration remove-mock confirm_atlas_manager_mock_runtime_configuration_removal
```

The profile is fixed to `127.0.0.1`, port `3000`, the mock power backend,
disabled power effects and scheduler, an `always_on` policy, an empty service
catalog, and disabled administrative routes. The exact profile is validated by
the application TypeScript parser in tests.

The installer is root-only, does not read or adopt an existing environment
file, writes atomically, and preserves the file when removal cannot be
verified. It never starts systemd, runs Atlas Manager, installs the helper, or
changes runtime identities. The confirmation is an anti-accident control, not
a credential, and is never persisted or logged.
