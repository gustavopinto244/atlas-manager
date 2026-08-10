# Atlas Manager installation and reinstallation

This guide is the canonical entry point for installing Atlas Manager. It
consolidates the existing qualified tools without replacing their stricter
runbooks. The server is installed from an immutable Linux `amd64` release
bundle; the `atlas` operator CLI is a separate, unprivileged npm package.

The installation model is disabled-first. File installation, runtime identity,
configuration and service activation are separate gates. Stop at the first
blocked or failed result and preserve its output as evidence.

## Safety baseline

Initial installation, reinstallation and acceptance must preserve:

```text
HOST=127.0.0.1
PORT=3000
POWER_MANAGEMENT_BACKEND=mock
MACHINE_POWER_EFFECTS_ACTIVATION=disabled
MACHINE_POWER_SCHEDULER_ENABLED=false
ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false
ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false
```

Wake and shutdown HTTP may be enabled later only for the qualified
simulation-only profile. That profile must still use the mock backend with
effects and the machine scheduler disabled. This guide never installs or
activates the Linux power helper and never performs a real shutdown, reboot,
wake-alarm or RTC mutation.

## Host Node.js runtime

The service unit runs `ExecStart=/usr/bin/node`, so `/usr/bin/node` must be the
interpreter the host provides:

```text
supported range: >=24 <25   (package.json "engines.node")
required path:   /usr/bin/node
required type:   regular file owned by root, executable, not a symlink
```

`package.json` is the source of truth for the range. Host qualification and the
installer both accept any release inside it, so a Node 24 security patch does
not require a new deployment build. Verify with:

```bash
/usr/bin/node --version
```

A `node` resolved through nvm, `$PATH` or a shell profile does not satisfy this
requirement, and neither does a symlink at `/usr/bin/node`. Qualification
inspects the path with `lstat` and reports `node_runtime_unsafe` for a symlink
and `node_runtime_version_mismatch` for an out-of-range release. If the
workstation uses nvm, note that `node --version` in a shell may report a
different release than the one the service will execute; only the reading from
`/usr/bin/node` above is authoritative.

Bundle reproduction is a separate, stricter constraint: a release bundle is
built with one exact pinned toolchain, recorded in the release evidence, and
that pin is not relaxed by this range.

## Supported installation products

| Product               | Purpose                                                                        | Installation boundary                                                    |
| --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Atlas Server Bundle   | Atlas Manager service, dashboard, configuration contracts and deployment tools | Root-controlled Linux `amd64` host                                       |
| Atlas Operator Client | Reinstallable `atlas` CLI                                                      | Node.js 24 operator workstation; no server files or privileged mutations |

Do not install the server directly from a Git checkout, `dist/`, an old staging
directory or another host's extracted bundle. Use only a release candidate that
passed source qualification, independent Candidate A/B reproduction and archive
inspection.

## 1. Select and verify the server artifact

Record the expected source commit, version and archive SHA-256 from immutable
release evidence. Verify the archive before extraction:

```sh
sha256sum atlas-manager_<version>_linux_amd64.tar.gz
tar -tzf atlas-manager_<version>_linux_amd64.tar.gz
```

The digest must exactly match release evidence, and the archive must have one
top-level directory with no absolute paths, traversal, unsafe links or special
files. Extract into a new directory and enter the bundle root:

```sh
mkdir atlas-manager-install
tar -xzf atlas-manager_<version>_linux_amd64.tar.gz -C atlas-manager-install
cd atlas-manager-install/atlas-manager_<version>_linux_amd64
./atlas-manager-installer inspect-bundle
```

`inspect-bundle` is authoritative for `MANIFEST.json`, internal `SHA256SUMS`,
source commit, version, modes and required files. Do not repair a bundle by
editing, replacing or copying individual files.

The bundle also provides one read-only orchestration entrypoint:

```sh
./atlas-manager-server-installer inspect
./atlas-manager-server-installer plan
```

Use `plan` to collect the fixed bundle, host, identity, configuration and
lifecycle observations and identify the next explicit boundary. It does not
run that boundary, elevate privileges or accept confirmations. A blocked JSON
report is evidence, not permission to continue. See the
[server installation planner](operations/atlas-manager-server-installer.md).

The inspected root must also contain `INSTALLATION.md`. That generated file is
the release-specific, bundled installation contract; this repository guide
provides the broader operator context. If they disagree, stop and qualify the
source/bundle pair instead of mixing instructions from different releases.

## 2. Qualify the host read-only

Run the bundle's host qualification before any mutation:

```sh
sudo ./atlas-manager-host-qualification qualify
```

Retain the bounded JSON report and its SHA-256 outside the repository. Continue
only when the result is `qualified`, `prepared` or the narrowly defined
`preparation_required`. A partial identity, unmanaged deployment, unsafe path,
active lock, enabled service or unknown state is a blocker, not permission to
repair files manually.

Detailed contract:
[deployment host qualification](operations/atlas-manager-deployment-host-qualification.md).

## 3. Prepare the runtime identity when required

Skip mutation when the qualifier reports the managed identity is already valid.
When it reports exactly `preparation_required`, inspect and prepare the fixed
identity:

```sh
sudo ./atlas-manager-runtime-identity-installer inspect
sudo ./atlas-manager-runtime-identity-installer prepare-disabled \
  confirm_atlas_manager_runtime_identity_preparation
sudo ./atlas-manager-runtime-identity-installer verify-managed
sudo ./atlas-manager-host-qualification verify-prepared
```

This creates only the `atlas-manager` user, its primary group and the
`atlas-manager-power` group. It does not install the application, start
systemd, install a power helper or remove an existing identity.

Detailed contract:
[runtime identity preparation](operations/atlas-manager-runtime-identity-preparation.md).

## 4. Install the application disabled

Install and verify the reviewed release while the service remains disabled and
inactive:

```sh
sudo ./atlas-manager-installer install-disabled
sudo ./atlas-manager-installer verify-disabled
sudo ./atlas-manager-host-qualification verify-disabled-installation
```

The installer creates the managed release, atomically selects
`/opt/atlas-manager/current`, installs the systemd unit and safe configuration
template, and records deployment state. It does not create the real
environment, reload systemd, enable the unit or start Atlas Manager.

Detailed contract:
[disabled installation](operations/atlas-manager-disabled-installation.md).

## 5. Prepare the administrative configuration

The real input belongs only at the fixed root-managed path and must be mode
`0600`:

```sh
sudo install -o root -g root -m 0600 \
  ./atlas-manager.mock-admin.input.example.json \
  /etc/atlas-manager/administrative-runtime.input.json
sudoedit /etc/atlas-manager/administrative-runtime.input.json
```

Set the real Cloudflare Access team name, application audience, administrative
public origin and role assignments. A `principalId` must be the exact JWT `sub`;
do not invent it or place it in the bundle, repository, logs or command line.
The canonical public origin has no `/admin` suffix.

Validate, install and verify the generated environment:

```sh
sudo ./atlas-manager-administrative-runtime-configuration validate-input
sudo ./atlas-manager-administrative-runtime-configuration install-disabled \
  confirm_atlas_manager_mock_administrative_configuration
sudo ./atlas-manager-administrative-runtime-configuration verify-installed
```

The default input leaves wake and shutdown HTTP disabled. A separately reviewed
simulation profile may set `wakeAlarmHttpEnabled` and
`shutdownHttpEnabled` to `true`; it must not change the mock backend, disabled
effects or disabled machine scheduler.

Detailed contract:
[mock-administrative configuration](operations/atlas-manager-mock-administrative-configuration.md).

## 6. Activate the mock service lifecycle

Inspect before activation, then use the exact confirmation:

```sh
sudo ./atlas-manager-service-lifecycle inspect
sudo ./atlas-manager-service-lifecycle activate-mock \
  confirm_atlas_manager_mock_service_activation
sudo ./atlas-manager-service-lifecycle verify-active-mock
```

Activation verifies deployment, managed identity, configuration, event-history
readiness, loopback health and administrative route policy. A failed activation
must finish as a verified rollback or leave a recovery journal for inspection;
do not delete lifecycle state to force a retry.

Detailed contract:
[service lifecycle](operations/atlas-manager-service-lifecycle.md).

## 7. Validate the installed service

Verify systemd, loopback listeners and health:

```sh
systemctl is-active atlas-manager.service
systemctl is-enabled atlas-manager.service
curl --fail --silent http://127.0.0.1:3000/health/live
curl --fail --silent http://127.0.0.1:3000/health/server
ss -ltn
```

The Atlas listener must be exactly `127.0.0.1:3000`; ports `3000` and `3001`
must not bind publicly. Validate Nginx and cloudflared independently before
external acceptance. The administrative path remains:

```text
Cloudflare Access
  -> Cloudflare Tunnel
  -> Nginx 127.0.0.1:80
  -> Atlas Manager 127.0.0.1:3000
```

An unauthenticated administrative request must fail with `401`, while an
authorized Access principal must pass application RBAC. A Cloudflare Access
redirect is not an Atlas health failure. Review the service journal after
activation and require no repeated `administrative_host_rejected` events.

## 8. Install or reinstall the operator CLI

Build the independent client package with the pinned Node.js 24 toolchain:

```sh
npm run build
npm run package:operator
```

Verify `dist/operator-package/SHA256SUMS`, then install or reinstall the archive:

```sh
npm install --global \
  ./dist/operator-package/atlas-manager-operator-cli-<version>.tgz
atlas --help
atlas help
```

The client package contains no server, principal ID, assertion or sudo
credential. It forwards only a real Access assertion supplied through the
accepted transport boundary. See
[operator CLI package](operations/atlas-manager-operator-cli.md).

## 9. Reinstall or upgrade the server

Use a newly qualified bundle. Do not overwrite the current release directory
or reuse an old staging archive.

1. Qualify the current host and inspect the new bundle read-only.
2. Deactivate and verify the existing lifecycle.
3. Run the new bundle's `install-disabled` and `verify-disabled` actions.
4. Replace the managed administrative configuration only through
   `replace-disabled` with
   `confirm_atlas_manager_administrative_configuration_replacement`.
5. Verify the configuration, activate mock and run all post-install checks.

The installer keeps releases side by side and atomically moves `current`.
Configuration, event history, scheduler cursors, occurrence claims and
application state are preserved. Same-version reinstall must verify managed
bytes rather than adopt unknown files.

## 10. Rollback

At the first failed activation or post-install gate, stop retries and preserve
the report and journals. Use only managed rollback actions after inspecting the
recorded previous generation:

```sh
sudo ./atlas-manager-service-lifecycle deactivate \
  confirm_atlas_manager_service_deactivation
sudo ./atlas-manager-service-lifecycle verify-inactive
sudo ./atlas-manager-installer rollback-disabled
sudo ./atlas-manager-administrative-runtime-configuration rollback-disabled \
  confirm_atlas_manager_administrative_configuration_rollback
sudo ./atlas-manager-administrative-runtime-configuration verify-installed
sudo ./atlas-manager-service-lifecycle activate-mock \
  confirm_atlas_manager_mock_service_activation
sudo ./atlas-manager-service-lifecycle verify-active-mock
```

If a tool reports recovery required, do not manually edit selectors, managed
state or journals. Diagnose against the retained evidence before another
attempt.

## 11. Uninstall without purging operator data

Deactivate first, then remove only managed deployment files:

```sh
sudo ./atlas-manager-service-lifecycle deactivate \
  confirm_atlas_manager_service_deactivation
sudo ./atlas-manager-service-lifecycle verify-inactive
sudo ./atlas-manager-installer uninstall-disabled
sudo ./atlas-manager-host-qualification verify-removed
```

Uninstall intentionally preserves the real environment, runtime state, users,
groups, event history, backup records, scheduler stores and power occurrence
claims. There is no purge operation. Remove the client separately with:

```sh
npm uninstall --global @atlas-manager/operator-cli
```

## Installation evidence checklist

Record at minimum:

- source commit, version and archive SHA-256;
- bundle inspection and tar-safety result;
- host qualification before and after installation;
- runtime identity result;
- disabled installation result;
- administrative configuration result and non-secret input digest;
- lifecycle activation and rollback result;
- systemd state, loopback listeners and health;
- Nginx, cloudflared and Cloudflare Access acceptance;
- dashboard authentication/RBAC result;
- power backend, effects, scheduler and HTTP feature flags;
- relevant journal excerpts with secrets redacted.

## Post-install release steps

1. Re-run pinned Node and both Go module qualifications from a clean tree.
2. Produce independent Candidate A and Candidate B bundles and require byte
   equality.
3. Create immutable release evidence bound to the final source commit.
4. Perform read-only Atlas qualification, then a controlled disabled-first
   reinstall with rollback armed.
5. Validate dashboard pages, CLI commands, RBAC, audit and mock power simulation
   on Atlas.
6. Keep physical power effects and the machine scheduler disabled until a
   separate host-specific qualification and approval milestone exists.
