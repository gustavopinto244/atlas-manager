# Atlas Manager 1.0.0-rc.7

`1.0.0-rc.7` supersedes `1.0.0-rc.6` after physical Atlas qualification
exposed a false-positive runtime identity preparation block. Rc.6 correctly
accepted the trusted Ubuntu path layout, but still required an existing
`lastlog` to be empty when neither `--no-log-init` nor `LOG_INIT=no` supplied
global login-log suppression.

The bundle builder now canonicalizes every directory to `0755`, every regular
executable file to `0755`, and every other regular file to `0644`. This makes
the manifest, checksums, archive, and extracted modes independent of the
builder environment's `umask`. Commit-bound rc.7 bundles produced before this
correction are superseded and must not be used for physical qualification.

The Atlas host runs Ubuntu shadow `4.17.4-2ubuntu3`, built with
`--enable-lastlog=no`. Its fixed `/usr/sbin/useradd` does not advertise
`--no-log-init`, reports `LOG_INIT=yes`, and leaves the preexisting non-empty
`/var/log/lastlog` unchanged during an isolated account-creation simulation.
Upstream shadow 4.17.4 confirms that both the `--no-log-init` help entry and
`lastlog_reset` implementation are controlled by the same `ENABLE_LASTLOG`
build guard.

The rc.7 preparation policy therefore distinguishes the backends:

- when `--no-log-init` is advertised, it is passed to `useradd`;
- otherwise effective `LOG_INIT=no` suppresses login-log initialization;
- otherwise absence of the advertised option proves, for the supported
  shadow 4.17.4 source contract, that the `lastlog` backend is not built;
- `faillog` remains independently active and a present non-empty file still
  blocks before mutation;
- executable `/sbin/pam_tally2`, unsafe paths, ambiguous state, and changed
  immutable baselines remain fail-closed.

A trusted preexisting `lastlog`, including one containing historical records,
is captured in the immutable external-artifact baseline and must remain
unchanged. The installer never deletes, truncates, restores, changes the
ownership or permissions of, or otherwise normalizes that file.

Deterministic regression coverage proves that:

- a non-empty trusted `lastlog` is accepted and preserved when its backend is
  not built;
- a non-empty `faillog` still blocks before any account command;
- probed `--no-log-init` behavior remains unchanged;
- effective `LOG_INIT=no` behavior remains unchanged;
- the complete deployment Go suite continues to pass.

The rc.6 physical evidence remains historical. No `prepare-disabled` command
was executed with rc.6 after the false-positive classification, no runtime
identity was created, and the real `/var/log/lastlog` digest remained
unchanged. Rc.6 must not be merged, tagged, released, or retried physically.

The required rc.7 qualification sequence is:

1. complete all repository format, lint, type, build, test, audit, and
   rehearsal gates;
2. commit the reviewed rc.7 source changes;
3. generate a new commit-bound deployment bundle;
4. verify archive safety, outer checksum, internal checksums, and bundle
   inspection;
5. run read-only Atlas host qualification and runtime identity inspection;
6. review account-tool, login-log backend, and trusted-layout readiness;
7. perform one explicitly authorized `prepare-disabled` operation;
8. run `inspect`, `verify-managed`, and host `verify-prepared`;
9. continue with separately authorized disabled installation and the
   remaining physical qualification gates.

`1.0.0-rc.7` is not physically qualified yet. It does not claim physical
account creation, disabled installation, service lifecycle, RTC, D-Bus,
helper execution, or power behavior. Merge, tag, and release remain blocked
until the new commit-bound candidate completes the required qualification.
