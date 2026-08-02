package hostinspection

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitystate"
	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

const (
	MinimumFreeBytes = 64 * 1024 * 1024
	CapacityHeadroom = 64 * 1024 * 1024
	MaxConfiguration = 1 << 20
)

type Paths struct {
	BundleRoot          string
	Deployment          installer.Paths
	Opt                 string
	Usr                 string
	UsrBin              string
	Etc                 string
	Systemd             string
	SystemdSystem       string
	SystemdWants        string
	Var                 string
	VarLib              string
	Run                 string
	SystemdRun          string
	Passwd              string
	Group               string
	ApplicationState    string
	IdentityStateFile   string
	IdentityJournalFile string
}

func ProductionPaths(bundleRoot string) Paths {
	return Paths{
		BundleRoot: bundleRoot,
		Deployment: installer.ProductionPaths(),
		Opt:        "/opt", Usr: "/usr", UsrBin: "/usr/bin", Etc: "/etc", Systemd: "/etc/systemd", SystemdSystem: "/etc/systemd/system",
		SystemdWants: "/etc/systemd/system/multi-user.target.wants", Var: "/var", VarLib: "/var/lib",
		Run: "/run", SystemdRun: "/run/systemd/system", Passwd: "/etc/passwd", Group: "/etc/group",
		ApplicationState: "/var/lib/atlas-manager", IdentityStateFile: "/var/lib/atlas-manager-identity-preparation/state.json", IdentityJournalFile: "/var/lib/atlas-manager-identity-preparation/transaction.json",
	}
}

type Capacity struct {
	Available uint64
}

type Dependencies struct {
	EffectiveUID func() int
	Platform     func() string
	Architecture func() string
	CheckNode    func(context.Context, string) error
	Capacity     func(string) (Capacity, error)
	EnforceOwner bool
}

type DeploymentState string

const (
	DeploymentAbsent    DeploymentState = "absent"
	DeploymentManaged   DeploymentState = "managed_disabled"
	DeploymentUnmanaged DeploymentState = "unmanaged"
	DeploymentUnsafe    DeploymentState = "unsafe"
	DeploymentActive    DeploymentState = "active_or_ambiguous"
)

type Snapshot struct {
	Bundle           qualificationreport.Check
	Platform         qualificationreport.Check
	NodeRuntime      qualificationreport.Check
	Systemd          qualificationreport.Check
	Filesystem       qualificationreport.Check
	RuntimeIdentity  qualificationreport.Check
	IdentityState    runtimeidentity.State
	Identity         runtimeidentity.Identity
	Deployment       qualificationreport.Check
	DeploymentState  DeploymentState
	Configuration    qualificationreport.Check
	Lock             qualificationreport.Check
	Runtime          qualificationreport.Check
	Enablement       qualificationreport.Check
	Preparation      qualificationreport.Check
	PreparationState identitystate.State
	ApplicationState qualificationreport.Check
}

type Inspector struct {
	paths Paths
	deps  Dependencies
}

type StaticInspector struct {
	Value Snapshot
}

func (inspector StaticInspector) Inspect(context.Context) Snapshot { return inspector.Value }

func New(paths Paths, deps Dependencies) Inspector {
	if deps.EffectiveUID == nil {
		deps.EffectiveUID = os.Geteuid
	}
	if deps.Platform == nil {
		deps.Platform = func() string { return runtime.GOOS }
	}
	if deps.Architecture == nil {
		deps.Architecture = func() string { return runtime.GOARCH }
	}
	if deps.CheckNode == nil {
		deps.CheckNode = checkNode
	}
	if deps.Capacity == nil {
		deps.Capacity = statCapacity
	}
	return Inspector{paths: paths, deps: deps}
}

func (inspector Inspector) Inspect(ctx context.Context) Snapshot {
	snapshot := Snapshot{
		Platform:         check("platform", qualificationreport.Blocked, "unsupported_platform"),
		Bundle:           check("bundle", qualificationreport.Blocked, "bundle_invalid"),
		NodeRuntime:      check("node_runtime", qualificationreport.Blocked, "node_runtime_missing"),
		Systemd:          check("systemd", qualificationreport.Blocked, "systemd_unavailable"),
		Filesystem:       check("filesystem", qualificationreport.Blocked, "deployment_parent_unsafe"),
		RuntimeIdentity:  check("runtime_identity", qualificationreport.Blocked, "runtime_identity_invalid"),
		Deployment:       check("deployment", qualificationreport.Passed, "deployment_absent"),
		Configuration:    check("configuration", qualificationreport.Passed, "configuration_absent"),
		Lock:             check("deployment_lock", qualificationreport.Passed, "deployment_lock_absent"),
		Runtime:          check("runtime_activity", qualificationreport.Passed, "runtime_inactive"),
		Enablement:       check("service_enablement", qualificationreport.Passed, "service_disabled"),
		Preparation:      check("identity_preparation", qualificationreport.Warning, "identity_preparation_absent"),
		ApplicationState: check("application_state", qualificationreport.Passed, "application_state_absent"),
		IdentityState:    runtimeidentity.Blocked,
		DeploymentState:  DeploymentUnsafe,
	}

	if inspector.deps.EffectiveUID() != 0 {
		snapshot.Platform = check("platform", qualificationreport.Blocked, "effective_root_required")
	} else if inspector.deps.Platform() != "linux" {
		snapshot.Platform = check("platform", qualificationreport.Blocked, "unsupported_platform")
	} else if inspector.deps.Architecture() != "amd64" {
		snapshot.Platform = check("platform", qualificationreport.Blocked, "unsupported_architecture")
	} else {
		snapshot.Platform = check("platform", qualificationreport.Passed, "linux_amd64_root")
	}

	if err := installer.InspectBundleReadOnly(inspector.paths.BundleRoot); err == nil && inspector.qualifierPresent() {
		snapshot.Bundle = check("bundle", qualificationreport.Passed, "bundle_valid")
	} else {
		snapshot.Bundle = check("bundle", qualificationreport.Blocked, "bundle_invalid")
	}
	if snapshot.Platform.Status == qualificationreport.Blocked {
		snapshot.NodeRuntime = check("node_runtime", qualificationreport.Blocked, snapshot.Platform.Code)
	} else {
		snapshot.NodeRuntime = inspector.inspectNode(ctx)
	}
	snapshot.Systemd = inspector.inspectSystemd()
	snapshot.Filesystem = inspector.inspectFilesystem(snapshot.Bundle)
	if snapshot.Platform.Status == qualificationreport.Blocked {
		snapshot.RuntimeIdentity = check("runtime_identity", qualificationreport.Blocked, snapshot.Platform.Code)
		snapshot.IdentityState = runtimeidentity.Blocked
	} else {
		snapshot.RuntimeIdentity, snapshot.IdentityState, snapshot.Identity = inspector.inspectIdentity()
	}
	snapshot.Configuration = inspector.inspectConfiguration(snapshot.IdentityState, snapshot.Identity)
	snapshot.ApplicationState = inspector.inspectAbsent(inspector.paths.ApplicationState, "application_state")
	snapshot.Lock = inspector.inspectLock()
	snapshot.Runtime = inspector.inspectAbsent(inspector.paths.Deployment.RuntimeDir, "runtime_activity")
	snapshot.Enablement = inspector.inspectAbsent(inspector.paths.Deployment.EnableLink, "service_enablement")
	snapshot.Deployment, snapshot.DeploymentState = inspector.inspectDeployment(snapshot.IdentityState, snapshot.Identity, snapshot.Lock, snapshot.Runtime, snapshot.Enablement)
	snapshot.Preparation, snapshot.PreparationState = inspector.inspectIdentityPreparation(snapshot.IdentityState, snapshot.Identity)
	return snapshot
}

func (inspector Inspector) inspectIdentityPreparation(state runtimeidentity.State, identity runtimeidentity.Identity) (qualificationreport.Check, identitystate.State) {
	journal, journalSeen, journalErr := identitystate.ReadJournal(inspector.paths.IdentityJournalFile)
	_ = journal
	if journalSeen || journalErr != nil {
		if journalSeen && !inspector.safePrivateFile(inspector.paths.IdentityJournalFile) {
			return check("identity_preparation", qualificationreport.Blocked, "managed_state_invalid"), identitystate.Unsafe
		}
		return check("identity_preparation", qualificationreport.Blocked, "preparation_journal_present"), identitystate.Interrupted
	}
	managed, stateSeen, stateErr := identitystate.ReadState(inspector.paths.IdentityStateFile)
	if stateErr != nil {
		return check("identity_preparation", qualificationreport.Blocked, "managed_state_invalid"), identitystate.Unsafe
	}
	if stateSeen && !inspector.safePrivateFile(inspector.paths.IdentityStateFile) {
		return check("identity_preparation", qualificationreport.Blocked, "managed_state_invalid"), identitystate.Unsafe
	}
	if !stateSeen {
		return check("identity_preparation", qualificationreport.Warning, "identity_preparation_absent"), identitystate.Absent
	}
	if state != runtimeidentity.Ready || managed == nil || managed.RuntimeUser.ID != identity.UserID || managed.PrimaryGroup.ID != identity.PrimaryGroupID || managed.HelperGroup.ID != identity.HelperGroupID {
		return check("identity_preparation", qualificationreport.Blocked, "managed_state_invalid"), identitystate.Unsafe
	}
	return check("identity_preparation", qualificationreport.Passed, "managed_prepared"), identitystate.ManagedPrepared
}

func (inspector Inspector) qualifierPresent() bool {
	info, err := os.Lstat(filepath.Join(inspector.paths.BundleRoot, "atlas-manager-host-qualification"))
	return err == nil && info.Mode().IsRegular() && info.Mode().Perm() == 0o755 && info.Mode()&os.ModeSymlink == 0
}

func (inspector Inspector) inspectNode(ctx context.Context) qualificationreport.Check {
	for _, parent := range []string{inspector.paths.Usr, inspector.paths.UsrBin} {
		if !inspector.safeDirectory(parent) {
			return check("node_runtime", qualificationreport.Blocked, "node_runtime_unsafe")
		}
	}
	info, err := os.Lstat(inspector.paths.Deployment.Node)
	if err != nil {
		return check("node_runtime", qualificationreport.Blocked, "node_runtime_missing")
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o111 == 0 || (inspector.deps.EnforceOwner && fileUID(info) != 0) {
		return check("node_runtime", qualificationreport.Blocked, "node_runtime_unsafe")
	}
	if err := inspector.deps.CheckNode(ctx, inspector.paths.Deployment.Node); err != nil {
		return check("node_runtime", qualificationreport.Blocked, "node_runtime_version_mismatch")
	}
	return check("node_runtime", qualificationreport.Passed, "node_runtime_exact")
}

func (inspector Inspector) inspectSystemd() qualificationreport.Check {
	for _, path := range []string{inspector.paths.Systemd, inspector.paths.SystemdSystem, inspector.paths.SystemdWants, inspector.paths.SystemdRun} {
		if !inspector.safeDirectory(path) {
			return check("systemd", qualificationreport.Blocked, "systemd_path_unsafe")
		}
	}
	return check("systemd", qualificationreport.Passed, "systemd_available")
}

func (inspector Inspector) inspectFilesystem(bundle qualificationreport.Check) qualificationreport.Check {
	for _, path := range []string{inspector.paths.Opt, inspector.paths.Etc, inspector.paths.Var, inspector.paths.VarLib, inspector.paths.Run} {
		if !inspector.safeDirectory(path) {
			return check("filesystem", qualificationreport.Blocked, "deployment_parent_unsafe")
		}
	}
	if bundle.Status == qualificationreport.Blocked {
		return check("filesystem", qualificationreport.Blocked, "bundle_invalid")
	}
	manifestData, err := os.ReadFile(filepath.Join(inspector.paths.BundleRoot, "MANIFEST.json"))
	if err != nil {
		return check("filesystem", qualificationreport.Blocked, "bundle_invalid")
	}
	value, err := manifest.Decode(manifestData)
	if err != nil {
		return check("filesystem", qualificationreport.Blocked, "bundle_invalid")
	}
	var releaseSize uint64
	for _, file := range value.Files {
		releaseSize += uint64(file.Size)
	}
	required := releaseSize*2 + CapacityHeadroom
	for _, path := range []string{inspector.paths.Opt, inspector.paths.Etc, inspector.paths.VarLib, inspector.paths.Run} {
		capacity, capacityErr := inspector.deps.Capacity(path)
		if capacityErr != nil || capacity.Available < MinimumFreeBytes || (path == inspector.paths.Opt && capacity.Available < required) {
			return check("filesystem", qualificationreport.Blocked, "deployment_capacity_insufficient")
		}
	}
	return check("filesystem", qualificationreport.Passed, "deployment_parents_and_capacity_safe")
}

func (inspector Inspector) inspectIdentity() (qualificationreport.Check, runtimeidentity.State, runtimeidentity.Identity) {
	if !inspector.safeAccountFile(inspector.paths.Passwd) || !inspector.safeAccountFile(inspector.paths.Group) || !inspector.safeDirectory(inspector.paths.Etc) {
		return check("runtime_identity", qualificationreport.Blocked, "runtime_identity_files_unsafe"), runtimeidentity.Blocked, runtimeidentity.Identity{}
	}
	passwd, passwdErr := os.ReadFile(inspector.paths.Passwd)
	group, groupErr := os.ReadFile(inspector.paths.Group)
	if passwdErr != nil || groupErr != nil {
		return check("runtime_identity", qualificationreport.Blocked, "runtime_identity_files_unsafe"), runtimeidentity.Blocked, runtimeidentity.Identity{}
	}
	state, identity, err := runtimeidentity.ClassifyAccountContract(string(passwd), string(group))
	if state == runtimeidentity.Absent {
		return check("runtime_identity", qualificationreport.Warning, "runtime_identity_absent"), state, identity
	}
	if err != nil || state != runtimeidentity.Ready {
		return check("runtime_identity", qualificationreport.Blocked, safeIdentityCode(err)), runtimeidentity.Blocked, runtimeidentity.Identity{}
	}
	return check("runtime_identity", qualificationreport.Passed, "runtime_identity_ready"), state, identity
}

func (inspector Inspector) inspectConfiguration(state runtimeidentity.State, identity runtimeidentity.Identity) qualificationreport.Check {
	info, err := os.Lstat(inspector.paths.Deployment.Environment)
	if os.IsNotExist(err) {
		return check("configuration", qualificationreport.Passed, "configuration_absent")
	}
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o640 || fileNlink(info) != 1 || info.Size() > MaxConfiguration {
		return check("configuration", qualificationreport.Blocked, "configuration_metadata_unsafe")
	}
	if inspector.deps.EnforceOwner && (fileUID(info) != 0 || state != runtimeidentity.Ready || fileGID(info) != uint32(identity.PrimaryGroupID)) {
		return check("configuration", qualificationreport.Blocked, "configuration_metadata_unsafe")
	}
	return check("configuration", qualificationreport.Passed, "configuration_metadata_safe")
}

func (inspector Inspector) inspectLock() qualificationreport.Check {
	if exists(inspector.paths.Deployment.Lock) {
		return check("deployment_lock", qualificationreport.Blocked, "deployment_operation_active")
	}
	return check("deployment_lock", qualificationreport.Passed, "deployment_lock_absent")
}

func (inspector Inspector) inspectAbsent(path, name string) qualificationreport.Check {
	if exists(path) {
		code := "service_active_or_ambiguous"
		if name == "service_enablement" {
			code = "service_enabled"
		} else if name == "application_state" {
			code = "application_state_present"
		}
		return check(name, qualificationreport.Blocked, code)
	}
	if name == "service_enablement" {
		return check(name, qualificationreport.Passed, "service_disabled")
	}
	if name == "application_state" {
		return check(name, qualificationreport.Passed, "application_state_absent")
	}
	return check(name, qualificationreport.Passed, "runtime_inactive")
}

func (inspector Inspector) inspectDeployment(identityState runtimeidentity.State, identity runtimeidentity.Identity, lock, runtime, enablement qualificationreport.Check) (qualificationreport.Check, DeploymentState) {
	if lock.Status == qualificationreport.Blocked || runtime.Status == qualificationreport.Blocked || enablement.Status == qualificationreport.Blocked {
		return check("deployment", qualificationreport.Blocked, firstBlocked(lock, runtime, enablement)), DeploymentActive
	}
	_, stateExists, stateErr := installer.ReadState(inspector.paths.Deployment.StateFile)
	if stateErr != nil {
		return check("deployment", qualificationreport.Blocked, "deployment_unsafe"), DeploymentUnsafe
	}
	hasCurrent := exists(inspector.paths.Deployment.Current)
	hasUnit := exists(inspector.paths.Deployment.Unit)
	hasTemplate := exists(inspector.paths.Deployment.Template)
	hasRelease := hasReleaseDirectory(inspector.paths.Deployment.ReleaseRoot)
	if stateExists && identityState == runtimeidentity.Ready {
		if err := installer.VerifyManagedDisabled(inspector.paths.Deployment, identity, inspector.deps.EnforceOwner); err == nil {
			return check("deployment", qualificationreport.Passed, "managed_disabled"), DeploymentManaged
		}
		return check("deployment", qualificationreport.Blocked, "deployment_modified"), DeploymentUnsafe
	}
	rootState := inspector.inspectApplicationRoot()
	if rootState == DeploymentUnsafe {
		return check("deployment", qualificationreport.Blocked, "deployment_unsafe"), DeploymentUnsafe
	}
	if stateExists || hasCurrent || hasUnit || hasTemplate || hasRelease || rootState == DeploymentUnmanaged {
		return check("deployment", qualificationreport.Blocked, "deployment_unmanaged"), DeploymentUnmanaged
	}
	return check("deployment", qualificationreport.Passed, "deployment_absent"), DeploymentAbsent
}

func (inspector Inspector) inspectApplicationRoot() DeploymentState {
	root := filepath.Dir(inspector.paths.Deployment.ReleaseRoot)
	info, err := os.Lstat(root)
	if os.IsNotExist(err) {
		return DeploymentAbsent
	}
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || (inspector.deps.EnforceOwner && fileUID(info) != 0) || info.Mode().Perm()&0o022 != 0 {
		return DeploymentUnsafe
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return DeploymentUnsafe
	}
	allowed := map[string]bool{filepath.Base(inspector.paths.Deployment.ReleaseRoot): true, filepath.Base(inspector.paths.Deployment.Current): true}
	for _, entry := range entries {
		if !allowed[entry.Name()] {
			return DeploymentUnmanaged
		}
	}
	return DeploymentAbsent
}

func (inspector Inspector) safeDirectory(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.IsDir() && info.Mode()&os.ModeSymlink == 0 && info.Mode().Perm()&0o022 == 0 && (!inspector.deps.EnforceOwner || fileUID(info) == 0)
}

func (inspector Inspector) safeAccountFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 && info.Mode().Perm()&0o022 == 0 && fileNlink(info) == 1 && info.Size() >= 0 && info.Size() <= runtimeidentity.MaxAccountBytes && (!inspector.deps.EnforceOwner || fileUID(info) == 0)
}

func (inspector Inspector) safePrivateFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 && info.Mode().Perm() == 0o600 && fileNlink(info) == 1 && (!inspector.deps.EnforceOwner || fileUID(info) == 0)
}

func check(name string, status qualificationreport.Status, code string) qualificationreport.Check {
	return qualificationreport.Check{Name: name, Status: status, Code: code}
}

func safeIdentityCode(err error) string {
	if err == nil || len(err.Error()) > qualificationreport.MaxCodeLength {
		return "runtime_identity_invalid"
	}
	code := err.Error()
	if strings.HasPrefix(code, "runtime_") {
		return code
	}
	return "runtime_identity_invalid"
}

func firstBlocked(checks ...qualificationreport.Check) string {
	for _, item := range checks {
		if item.Status == qualificationreport.Blocked {
			return item.Code
		}
	}
	return "deployment_unsafe"
}

func hasReleaseDirectory(root string) bool {
	info, infoErr := os.Lstat(root)
	if os.IsNotExist(infoErr) {
		return false
	}
	if infoErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return true
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return true
	}
	for range entries {
		return true
	}
	return false
}

func exists(path string) bool { _, err := os.Lstat(path); return err == nil }

func fileNlink(info os.FileInfo) uint64 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(stats.Nlink)
	}
	return 0
}

func fileUID(info os.FileInfo) uint32 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return stats.Uid
	}
	return ^uint32(0)
}

func fileGID(info os.FileInfo) uint32 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return stats.Gid
	}
	return ^uint32(0)
}

func checkNode(ctx context.Context, path string) error {
	commandContext, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	command := exec.CommandContext(commandContext, path, "--version")
	command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TZ=UTC"}
	command.Stdin = strings.NewReader("")
	stdout := &boundedWriter{limit: 1024}
	stderr := &boundedWriter{limit: 1024}
	command.Stdout, command.Stderr = stdout, stderr
	if err := command.Run(); err != nil || stdout.overflow || stderr.overflow || strings.TrimSpace(string(stdout.data)) != "v24.18.0" {
		return fmt.Errorf("node_runtime_version_mismatch")
	}
	return nil
}

type boundedWriter struct {
	data     []byte
	limit    int
	overflow bool
}

func (writer *boundedWriter) Write(value []byte) (int, error) {
	if len(writer.data)+len(value) > writer.limit {
		writer.overflow = true
		return len(value), nil
	}
	writer.data = append(writer.data, value...)
	return len(value), nil
}

func statCapacity(path string) (Capacity, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		return Capacity{}, err
	}
	return Capacity{Available: uint64(stats.Bavail) * uint64(stats.Bsize)}, nil
}
