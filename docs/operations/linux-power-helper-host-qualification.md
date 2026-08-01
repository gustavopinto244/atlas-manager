# Linux power-helper host qualification

This procedure is operator-run and read-only. It qualifies only a candidate
for a disabled helper installation. It does not enable Atlas Manager, enroll a
user, program a wake alarm, or power off the host.

The reviewed bundle target is fixed to `GOOS=linux`, `GOARCH=amd64`,
`GOAMD64=v1`, and `CGO_ENABLED=0`. The CPU model may be recorded as operational
evidence, but is not an eligibility allowlist.

## Actions

From the unpacked reviewed bundle:

```bash
sudo ./bin/atlas-manager-power-helper-host-qualification qualify
sudo ./bin/atlas-manager-power-helper-host-qualification verify-disabled-installation
sudo ./bin/atlas-manager-power-helper-host-qualification verify-removed
```

The executable accepts no paths, flags, device names, bus addresses, or repair
options. Reports are compact JSON on stdout; stderr is intentionally empty.

## Disabled-installation drill

Use this exact sequence, with an operator recording each report hash:

```text
validate reviewed bundle
        ↓
create the empty atlas-manager-power group manually when absent
        ↓
run qualify
        ↓
install through the existing installer
        ↓
run verify-disabled-installation
        ↓
reboot the host without invoking the helper
        ↓
run verify-disabled-installation again
        ↓
uninstall through the existing installer
        ↓
run verify-removed
```

The qualification utility does not automate any state-changing step. The
installer remains the only installation boundary. The helper group must remain
empty; application-user enrollment and production activation require separate
review.

## Evidence and limitations

Keep completed reports and approvals in protected operational records, not in
public source control. The report contains only safe host facts and a hashed
boot identifier. A passing result does not certify firmware wake reliability,
real RTC mutation, real shutdown, or unattended scheduling.
