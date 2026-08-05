package identitypreparation

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/hostinspection"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identitycommand"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identityreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identitystate"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualification"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

const Confirmation = "confirm_atlas_manager_runtime_identity_preparation"

type Action string

const (
	Inspect         Action = "inspect"
	PrepareDisabled Action = "prepare-disabled"
	VerifyManaged   Action = "verify-managed"
)

func ValidAction(value string) bool {
	return value == string(Inspect) || value == string(PrepareDisabled) || value == string(VerifyManaged)
}

type Paths struct {
	BundleRoot         string
	Passwd             string
	Group              string
	Shadow             string
	GShadow            string
	Etc                string
	Usr                string
	UsrSbin            string
	Helper             string
	PamTally2          string
	RuntimeHome        string
	ApplicationState   string
	DeploymentRoot     string
	DeploymentCurrent  string
	DeploymentReleases string
	DeploymentUnit     string
	DeploymentEnable   string
	DeploymentState    string
	DeploymentLock     string
	RuntimeActivity    string
	Configuration      string
	StateDirectory     string
	StateFile          string
	Journal            string
	Lock               string
	MailSpoolPaths     []string
	LoginLogPaths      []string
}

func ProductionPaths(bundleRoot string) Paths {
	return Paths{
		BundleRoot: bundleRoot, Passwd: "/etc/passwd", Group: "/etc/group", Shadow: "/etc/shadow", GShadow: "/etc/gshadow", Etc: "/etc", Usr: "/usr", UsrSbin: "/usr/sbin",
		Helper: "/usr/local/libexec/atlas-manager-power-helper", PamTally2: "/sbin/pam_tally2", RuntimeHome: "/var/lib/atlas-manager", ApplicationState: "/var/lib/atlas-manager",
		DeploymentRoot: "/opt/atlas-manager", DeploymentCurrent: "/opt/atlas-manager/current", DeploymentReleases: "/opt/atlas-manager/releases", DeploymentUnit: "/etc/systemd/system/atlas-manager.service",
		DeploymentEnable: "/etc/systemd/system/multi-user.target.wants/atlas-manager.service", DeploymentState: "/var/lib/atlas-manager-deployment/state.json", DeploymentLock: "/run/atlas-manager-deployment.lock", RuntimeActivity: "/run/atlas-manager",
		Configuration: "/etc/atlas-manager/atlas-manager.env", StateDirectory: "/var/lib/atlas-manager-identity-preparation", StateFile: "/var/lib/atlas-manager-identity-preparation/state.json", Journal: "/var/lib/atlas-manager-identity-preparation/transaction.json", Lock: "/run/atlas-manager-identity-preparation.lock",
		MailSpoolPaths: []string{"/var/mail/atlas-manager", "/var/spool/mail/atlas-manager"}, LoginLogPaths: []string{"/var/log/lastlog", "/var/log/faillog", "/var/log/tallylog"},
	}
}

type Dependencies struct {
	EffectiveUID        func() int
	Platform            func() string
	Architecture        func() string
	ReadFile            func(string) ([]byte, error)
	Exists              func(string) bool
	HostQualify         func(context.Context) (qualificationreport.Report, error)
	ValidateTool        func(string) error
	ValidateDirectory   func(string) error
	ValidateAccountFile func(string) error
	ValidatePrivatePath func(string) error
	BundleMetadata      func(string) (string, string, error)
	Executor            identitycommand.Executor
	Now                 func() time.Time
}

type Preparation struct {
	paths Paths
	deps  Dependencies
}

func New(paths Paths, deps Dependencies) Preparation {
	if deps.EffectiveUID == nil {
		deps.EffectiveUID = os.Geteuid
	}
	if deps.Platform == nil {
		deps.Platform = func() string { return runtime.GOOS }
	}
	if deps.Architecture == nil {
		deps.Architecture = func() string { return runtime.GOARCH }
	}
	if deps.ReadFile == nil {
		deps.ReadFile = os.ReadFile
	}
	if deps.Exists == nil {
		deps.Exists = func(path string) bool { _, err := os.Lstat(path); return err == nil }
	}
	if deps.ValidateTool == nil {
		deps.ValidateTool = validateTool
	}
	if deps.ValidateAccountFile == nil {
		deps.ValidateAccountFile = validateAccountFile
	}
	if deps.ValidateDirectory == nil {
		deps.ValidateDirectory = validateDirectory
	}
	if deps.ValidatePrivatePath == nil {
		deps.ValidatePrivatePath = validatePrivatePath
	}
	if deps.BundleMetadata == nil {
		deps.BundleMetadata = bundleMetadata
	}
	if deps.Executor == nil {
		deps.Executor = identitycommand.OSExecutor{}
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	if deps.HostQualify == nil {
		deps.HostQualify = func(ctx context.Context) (qualificationreport.Report, error) {
			hostPaths := hostinspection.ProductionPaths(paths.BundleRoot)
			report, err := qualification.Run(ctx, qualification.Qualify, hostinspection.New(hostPaths, hostinspection.Dependencies{EffectiveUID: deps.EffectiveUID}))
			return report, err
		}
	}
	return Preparation{paths: paths, deps: deps}
}

func (preparation Preparation) Run(ctx context.Context, action Action, confirmation string) (identityreport.Report, error) {
	if preparation.deps.EffectiveUID() != 0 {
		return preparation.failureReport(action, preparation.blockedSnapshot("effective_root_required"), "effective_root_required"), nil
	}
	if preparation.deps.Platform() != "linux" || preparation.deps.Architecture() != "amd64" {
		return preparation.failureReport(action, preparation.blockedSnapshot("unsupported_platform"), "unsupported_platform"), nil
	}
	snapshot := preparation.inspectSnapshot()
	if action == Inspect {
		return preparation.report(action, snapshot), nil
	}
	if action == PrepareDisabled {
		if confirmation != Confirmation {
			return preparation.failureReport(action, snapshot, "confirmation_invalid"), nil
		}
		return preparation.prepare(ctx, snapshot)
	}
	if action == VerifyManaged {
		if snapshot.state != identitystate.ManagedPrepared {
			return preparation.failureReport(action, snapshot, "identity_state_unmanaged"), nil
		}
		if report, err := preparation.dependencyReport(ctx); err != nil || (report.Result != "qualified" && report.Result != "prepared") {
			return preparation.failureReport(action, snapshot, "qualification_precondition_failed"), nil
		}
		return preparation.report(action, snapshot), nil
	}
	return identityreport.Report{}, fmt.Errorf("action_invalid")
}

type snapshot struct {
	state                                                                            identitystate.State
	identity                                                                         runtimeidentity.Identity
	stateValue                                                                       *identitystate.ManagedState
	journal                                                                          identitystate.Journal
	journalSeen                                                                      bool
	identityCheck, stateCheck, journalCheck, deploymentCheck, helperCheck, lockCheck identityreport.Check
	passwordCheck                                                                    identityreport.Check
	loginLogCheck                                                                    identityreport.Check
}

func (preparation Preparation) inspectSnapshot(lockHeld ...bool) snapshot {
	value := snapshot{
		identityCheck:   identityCheck("identity_state_invalid", identityreport.Blocked),
		stateCheck:      check("managed_state", identityreport.Passed, "managed_state_absent"),
		journalCheck:    check("transaction", identityreport.Passed, "transaction_absent"),
		deploymentCheck: check("deployment", identityreport.Passed, "deployment_absent"),
		helperCheck:     check("helper_installation", identityreport.Passed, "helper_absent"),
		lockCheck:       check("preparation_lock", identityreport.Passed, "preparation_lock_absent"),
		passwordCheck:   check("runtime_password", identityreport.NotApplicable, "password_state_not_inspected"),
		loginLogCheck:   check("login_log_strategy", identityreport.NotApplicable, "login_log_strategy_not_inspected"),
	}
	passwd, passwdErr := preparation.deps.ReadFile(preparation.paths.Passwd)
	group, groupErr := preparation.deps.ReadFile(preparation.paths.Group)
	if passwdErr != nil || groupErr != nil || preparation.deps.ValidateDirectory(preparation.paths.Etc) != nil {
		value.state = identitystate.Unsafe
		value.identityCheck = identityCheck("account_database_unsafe", identityreport.Blocked)
	} else {
		if preparation.deps.ValidateAccountFile(preparation.paths.Passwd) != nil || preparation.deps.ValidateAccountFile(preparation.paths.Group) != nil {
			value.state = identitystate.Unsafe
			value.identityCheck = identityCheck("account_database_unsafe", identityreport.Blocked)
			return value
		}
		managed, stateSeen, stateErr := identitystate.ReadState(preparation.paths.StateFile)
		journal, journalSeen, journalErr := identitystate.ReadJournal(preparation.paths.Journal)
		value.journal = journal
		value.journalSeen = journalSeen
		if stateSeen && preparation.deps.ValidatePrivatePath(preparation.paths.StateFile) != nil {
			value.state = identitystate.Unsafe
			value.stateCheck = check("managed_state", identityreport.Blocked, "managed_state_invalid")
		} else if stateErr != nil {
			value.state = identitystate.Unsafe
			value.stateCheck = check("managed_state", identityreport.Blocked, "managed_state_invalid")
		} else if stateSeen {
			value.stateValue = managed
			value.stateCheck = check("managed_state", identityreport.Passed, "managed_state_valid")
		}
		if journalSeen && preparation.deps.ValidatePrivatePath(preparation.paths.Journal) != nil {
			value.state = identitystate.Unsafe
			value.journalCheck = check("transaction", identityreport.Blocked, "preparation_journal_invalid")
		} else if journalErr != nil {
			value.state = identitystate.Unsafe
			value.journalCheck = check("transaction", identityreport.Blocked, "preparation_journal_invalid")
		} else if journalSeen {
			value.journalCheck = check("transaction", identityreport.Blocked, "preparation_journal_present")
		}
		value.state, value.identity, _ = identitystate.Classify(string(passwd), string(group), managed, journalSeen)
		value.identityCheck = identityCheck(string(value.state), identityStatus(value.state))
		if value.state == identitystate.ManagedPrepared {
			value.identityCheck = identityCheck("managed_prepared", identityreport.Passed)
		}
	}
	if preparation.deps.Exists(preparation.paths.Lock) {
		if preparation.deps.ValidatePrivatePath(preparation.paths.Lock) != nil {
			value.lockCheck = check("preparation_lock", identityreport.Blocked, "preparation_lock_unsafe")
		} else if len(lockHeld) > 0 && lockHeld[0] {
			value.lockCheck = check("preparation_lock", identityreport.NotApplicable, "preparation_lock_held_by_operation")
		} else {
			value.lockCheck = check("preparation_lock", identityreport.Blocked, "preparation_lock_conflict")
		}
	}
	if preparation.deps.Exists(preparation.paths.Helper) {
		value.helperCheck = check("helper_installation", identityreport.Blocked, "helper_installation_present")
	}
	value.passwordCheck = preparation.inspectPasswordState(value.state)
	if preparation.deps.Exists(preparation.paths.Configuration) || preparation.deps.Exists(preparation.paths.RuntimeHome) || preparation.deps.Exists(preparation.paths.ApplicationState) || preparation.deps.Exists(preparation.paths.DeploymentCurrent) || preparation.deps.Exists(preparation.paths.DeploymentReleases) || preparation.deps.Exists(preparation.paths.DeploymentUnit) || preparation.deps.Exists(preparation.paths.DeploymentEnable) || preparation.deps.Exists(preparation.paths.DeploymentState) || preparation.deps.Exists(preparation.paths.DeploymentLock) || preparation.deps.Exists(preparation.paths.RuntimeActivity) || preparation.anyPathExists(preparation.paths.MailSpoolPaths) {
		value.deploymentCheck = check("deployment", identityreport.Blocked, "deployment_present")
	}
	return value
}

func (preparation Preparation) dependencyReport(ctx context.Context) (qualificationreport.Report, error) {
	return preparation.deps.HostQualify(ctx)
}

const (
	loginLogsSuppressedByOption  = "login_logs_suppressed_by_no_log_init"
	loginLogsSuppressedByDefault = "login_logs_suppressed_by_log_init_no"
	loginLogsBackendProvenSafe   = "login_logs_backend_proven_safe"
	maxLoginLogBaselineSize      = 1 << 20
)

type loginLogArtifact struct {
	path            string
	present         bool
	mode            os.FileMode
	uid, gid, nlink uint64
	dev, ino        uint64
	size            int64
	mtime, ctime    int64
	digest          [sha256.Size]byte
}

type loginLogLayoutArtifact struct {
	path         string
	present      bool
	mode         os.FileMode
	uid, gid     uint64
	nlink        uint64
	dev, ino     uint64
	mtime, ctime int64
	target       string
}

type loginLogBaseline struct {
	Artifacts []loginLogArtifact
	Layout    []loginLogLayoutArtifact
}

func (preparation Preparation) selectLoginLogStrategy(ctx context.Context, readiness identitycommand.Readiness) (string, loginLogBaseline, string) {
	baseline, ok := preparation.captureLoginLogBaseline()
	if !ok {
		return "", loginLogBaseline{}, "login_log_path_unsafe"
	}
	if readiness.Capabilities.NoLogInit {
		return loginLogsSuppressedByOption, baseline, ""
	}
	if readiness.Defaults.LogInit == "no" {
		return loginLogsSuppressedByDefault, baseline, ""
	}
	if preparation.deps.Exists(preparation.paths.PamTally2) {
		if !validateLoginLogExecutable(preparation.paths.PamTally2) {
			return "", baseline, "login_log_path_unsafe"
		}
		return "", baseline, "login_log_strategy_unsupported"
	}
	if _, err := identitycommand.ProbeAccountToolPackage(ctx, preparation.deps.Executor); err != nil {
		return "", baseline, "login_log_strategy_unsupported"
	}
	// In shadow 4.17.4, the --no-log-init help entry and lastlog_reset are
	// compiled under the same ENABLE_LASTLOG guard. Reaching this branch
	// without that advertised option proves that the lastlog backend is not
	// built. Faillog remains active independently and must still be empty.
	for _, artifact := range baseline.Artifacts {
		if !artifact.present || artifact.path == preparation.paths.LoginLogPaths[0] || artifact.path == preparation.paths.LoginLogPaths[2] {
			continue
		}
		if artifact.size != 0 {
			return "", baseline, "login_log_strategy_unsupported"
		}
	}
	return loginLogsBackendProvenSafe, baseline, ""
}

func (preparation Preparation) captureLoginLogBaseline() (loginLogBaseline, bool) {
	layout, ok := preparation.captureLoginLogLayout()
	if !ok {
		return loginLogBaseline{}, false
	}
	paths := append([]string{}, preparation.paths.LoginLogPaths...)
	if preparation.paths.PamTally2 != "" {
		paths = append(paths, preparation.paths.PamTally2)
	}
	baseline := loginLogBaseline{Artifacts: make([]loginLogArtifact, 0, len(paths)), Layout: layout}
	for index, path := range paths {
		artifact, ok := captureLoginLogArtifact(path, artifactPolicyFor(index, preparation.paths.LoginLogPaths), preparation.paths.Group)
		if !ok {
			return loginLogBaseline{}, false
		}
		baseline.Artifacts = append(baseline.Artifacts, artifact)
	}
	return baseline, true
}

func (preparation Preparation) captureLoginLogLayout() ([]loginLogLayoutArtifact, bool) {
	if len(preparation.paths.LoginLogPaths) == 0 || preparation.paths.PamTally2 == "" {
		return nil, false
	}
	logDir := filepath.Dir(preparation.paths.LoginLogPaths[0])
	varDir := filepath.Dir(logDir)
	for _, path := range preparation.paths.LoginLogPaths {
		if filepath.Dir(path) != logDir {
			return nil, false
		}
	}
	sbin := filepath.Dir(preparation.paths.PamTally2)
	entries := []loginLogLayoutArtifact{}
	for _, path := range []string{varDir, logDir, preparation.paths.Usr, preparation.paths.UsrSbin, sbin} {
		if duplicateLayoutPath(entries, path) {
			continue
		}
		entry, ok := captureLoginLogLayoutArtifact(path)
		if !ok {
			return nil, false
		}
		entries = append(entries, entry)
	}
	if !validateTrustedSafeDirectory(varDir) || !validateTrustedLogDirectory(logDir, preparation.paths.Group) || !validateTrustedMergedUsr(sbin, preparation.paths.Usr, preparation.paths.UsrSbin) {
		return nil, false
	}
	return entries, true
}

func duplicateLayoutPath(entries []loginLogLayoutArtifact, path string) bool {
	for _, entry := range entries {
		if entry.path == path {
			return true
		}
	}
	return false
}

func captureLoginLogLayoutArtifact(path string) (loginLogLayoutArtifact, bool) {
	entry := loginLogLayoutArtifact{path: path}
	info, err := os.Lstat(path)
	if err != nil {
		return entry, false
	}
	stats, ok := info.Sys().(*syscall.Stat_t)
	if !ok || info.Mode()&os.ModeSymlink != 0 && fileUID(info) != expectedExternalUID() {
		return entry, false
	}
	entry.present = true
	entry.mode = info.Mode()
	entry.uid = uint64(stats.Uid)
	entry.gid = uint64(stats.Gid)
	entry.nlink = uint64(stats.Nlink)
	entry.dev = uint64(stats.Dev)
	entry.ino = uint64(stats.Ino)
	entry.mtime = info.ModTime().UnixNano()
	entry.ctime = stats.Ctim.Sec*1e9 + int64(stats.Ctim.Nsec)
	if info.Mode()&os.ModeSymlink != 0 {
		target, err := os.Readlink(path)
		if err != nil {
			return entry, false
		}
		entry.target = target
	}
	return entry, true
}

func validateTrustedLogDirectory(path, groupPath string) bool {
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() || fileUID(info) != expectedExternalUID() || info.Mode().Perm()&0o002 != 0 {
		return false
	}
	if info.Mode().Perm()&0o020 != 0 {
		if os.Geteuid() == 0 {
			return groupNameForGID(groupPath, fileGID(info)) == "syslog"
		}
		return fileGID(info) == uint32(os.Getegid())
	}
	return true
}

func validateTrustedSafeDirectory(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode()&os.ModeSymlink == 0 && info.IsDir() && fileUID(info) == expectedExternalUID() && info.Mode().Perm()&0o022 == 0
}

func validateTrustedMergedUsr(sbin, usr, usrSbin string) bool {
	if !validateTrustedSafeDirectory(usr) || !validateTrustedSafeDirectory(usrSbin) {
		return false
	}
	info, err := os.Lstat(sbin)
	if err != nil || fileUID(info) != expectedExternalUID() {
		return false
	}
	if info.Mode()&os.ModeSymlink == 0 {
		return info.IsDir() && info.Mode().Perm()&0o022 == 0
	}
	target, err := os.Readlink(sbin)
	if err != nil || !canonicalMergedUsrTarget(target) {
		return false
	}
	resolved := target
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(filepath.Dir(sbin), resolved)
	}
	return filepath.Clean(resolved) == filepath.Clean(usrSbin)
}

func canonicalMergedUsrTarget(target string) bool {
	return target == "usr/sbin" || target == "/usr/sbin"
}

type loginLogArtifactPolicy int

const (
	loginLogLastlog loginLogArtifactPolicy = iota
	loginLogOther
	loginLogPamTally
)

func artifactPolicyFor(index int, paths []string) loginLogArtifactPolicy {
	if index < len(paths) {
		if index == 0 {
			return loginLogLastlog
		}
		return loginLogOther
	}
	return loginLogPamTally
}

func captureLoginLogArtifact(path string, policy loginLogArtifactPolicy, groupPath string) (loginLogArtifact, bool) {
	artifact := loginLogArtifact{path: path}
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return artifact, true
	}
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || fileUID(info) != expectedExternalUID() || fileNlink(info) != 1 || info.Size() > maxLoginLogBaselineSize || !safeLoginLogMode(info.Mode(), policy) || !safeLoginLogGroup(info, policy, groupPath) {
		return artifact, false
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return artifact, false
	}
	stats, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return artifact, false
	}
	artifact.present = true
	artifact.mode = info.Mode()
	artifact.uid = uint64(stats.Uid)
	artifact.gid = uint64(stats.Gid)
	artifact.nlink = uint64(stats.Nlink)
	artifact.dev = uint64(stats.Dev)
	artifact.ino = uint64(stats.Ino)
	artifact.size = info.Size()
	artifact.mtime = info.ModTime().UnixNano()
	artifact.ctime = stats.Ctim.Sec*1e9 + int64(stats.Ctim.Nsec)
	artifact.digest = sha256.Sum256(data)
	return artifact, true
}

func safeLoginLogMode(mode os.FileMode, policy loginLogArtifactPolicy) bool {
	if mode.Perm()&0o002 != 0 {
		return false
	}
	if policy == loginLogLastlog {
		return true
	}
	return mode.Perm()&0o022 == 0
}

func safeLoginLogGroup(info os.FileInfo, policy loginLogArtifactPolicy, groupPath string) bool {
	if policy != loginLogLastlog {
		return info.Mode().Perm()&0o020 == 0
	}
	if os.Geteuid() != 0 && fileGID(info) == uint32(os.Getegid()) {
		return true
	}
	return groupNameForGID(groupPath, fileGID(info)) == "utmp"
}

func expectedExternalUID() uint32 {
	if os.Geteuid() == 0 {
		return 0
	}
	return uint32(os.Geteuid())
}

func fileGID(info os.FileInfo) uint32 {
	stats, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return ^uint32(0)
	}
	return stats.Gid
}

func groupNameForGID(path string, gid uint32) string {
	data, err := os.ReadFile(path)
	if err != nil || len(data) > 1<<20 {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) >= 4 && fields[3] == strconv.FormatUint(uint64(gid), 10) {
			return fields[0]
		}
	}
	return ""
}

func (preparation Preparation) baselineMatches(baseline loginLogBaseline) bool {
	layout, ok := preparation.captureLoginLogLayout()
	if !ok || len(layout) != len(baseline.Layout) {
		return false
	}
	for index, expected := range baseline.Layout {
		actual := layout[index]
		if actual != expected {
			return false
		}
	}
	for index, expected := range baseline.Artifacts {
		actual, ok := captureLoginLogArtifact(expected.path, artifactPolicyFor(index, preparation.paths.LoginLogPaths), preparation.paths.Group)
		if !ok || actual.present != expected.present {
			return false
		}
		if !expected.present {
			continue
		}
		if actual.mode != expected.mode || actual.uid != expected.uid || actual.gid != expected.gid || actual.nlink != expected.nlink || actual.dev != expected.dev || actual.ino != expected.ino || actual.size != expected.size || actual.mtime != expected.mtime || actual.ctime != expected.ctime || actual.digest != expected.digest {
			return false
		}
	}
	return true
}

func (preparation Preparation) prepare(ctx context.Context, snapshot snapshot) (identityreport.Report, error) {
	if snapshot.state != identitystate.Absent || snapshot.journalSeen || snapshot.passwordCheck.Status == identityreport.Blocked || snapshot.deploymentCheck.Status == identityreport.Blocked || snapshot.helperCheck.Status == identityreport.Blocked || snapshot.lockCheck.Status == identityreport.Blocked {
		return preparation.failureReport(PrepareDisabled, snapshot, "qualification_precondition_failed"), nil
	}
	qualificationResult, err := preparation.dependencyReport(ctx)
	if err != nil || qualificationResult.Result != "preparation_required" {
		return preparation.failureReport(PrepareDisabled, snapshot, "qualification_precondition_failed"), nil
	}
	for _, tool := range []string{"/usr/sbin/groupadd", "/usr/sbin/useradd", "/usr/sbin/userdel", "/usr/sbin/groupdel"} {
		if err := preparation.deps.ValidateTool(tool); err != nil {
			return preparation.failureReport(PrepareDisabled, snapshot, "account_tool_unsafe"), nil
		}
	}
	readiness, readinessErr := identitycommand.ProbeReadiness(ctx, preparation.deps.Executor)
	if readinessErr != nil {
		return preparation.failureReport(PrepareDisabled, snapshot, readinessErr.Error()), nil
	}
	strategy, baseline, strategyCode := preparation.selectLoginLogStrategy(ctx, readiness)
	if strategyCode != "" {
		return preparation.failureReport(PrepareDisabled, snapshot, strategyCode), nil
	}
	readiness.SuppressionStrategy = strategy
	snapshot.loginLogCheck = check("login_log_strategy", identityreport.Passed, strategy)
	lock, err := preparation.acquireLock()
	if err != nil {
		return preparation.failureReport(PrepareDisabled, snapshot, "preparation_lock_conflict"), nil
	}
	lockReleased := false
	defer func() {
		if !lockReleased {
			preparation.releaseLock(lock)
		}
	}()
	current := preparation.inspectSnapshot(true)
	if current.state != identitystate.Absent || current.journalSeen || current.passwordCheck.Status == identityreport.Blocked || current.deploymentCheck.Status == identityreport.Blocked || current.helperCheck.Status == identityreport.Blocked {
		return preparation.failureReport(PrepareDisabled, current, "identity_state_not_absent"), nil
	}
	current.loginLogCheck = snapshot.loginLogCheck
	if !preparation.baselineMatches(baseline) {
		return preparation.failureReport(PrepareDisabled, current, "login_log_artifact_changed"), nil
	}
	commit, version, metadataErr := preparation.deps.BundleMetadata(preparation.paths.BundleRoot)
	if metadataErr != nil {
		return preparation.failureReport(PrepareDisabled, current, "bundle_invalid"), nil
	}
	journal := identitystate.Journal{SchemaVersion: identitystate.SchemaVersion, Status: "in_progress", Resources: []string{identitystate.ResourcePrimaryGroup, identitystate.ResourceHelperGroup, identitystate.ResourceRuntimeUser}, SourceCommit: commit, BundleVersion: version}
	if err := identitystate.WriteJournal(preparation.paths.StateDirectory, preparation.paths.Journal, journal); err != nil {
		return preparation.failureReport(PrepareDisabled, current, "preparation_journal_write_failed"), nil
	}
	createdPrimary, createdHelper, createdUser := false, false, false
	primaryID, helperID := 0, 0
	createdIdentity := runtimeidentity.Identity{}
	fail := func(code string) (identityreport.Report, error) {
		if createdUser || createdHelper || createdPrimary {
			if preparation.rollback(ctx, createdUser, createdHelper, createdPrimary, createdIdentity, primaryID, helperID, baseline) {
				preparation.releaseLock(lock)
				lockReleased = true
				if identitystate.RemoveJournal(preparation.paths.Journal) == nil && preparation.verifyRollbackArtifacts(true, baseline, false) {
					return preparation.failureReport(PrepareDisabled, current, code+"_rolled_back"), nil
				}
				_ = preparation.retainRecoveryJournal(journal)
				return preparation.failureReport(PrepareDisabled, current, code+"_recovery_required"), nil
			}
			preparation.releaseLock(lock)
			lockReleased = true
			return preparation.failureReport(PrepareDisabled, current, code+"_recovery_required"), nil
		}
		preparation.releaseLock(lock)
		lockReleased = true
		return preparation.failureReport(PrepareDisabled, current, code), nil
	}
	if result := preparation.deps.Executor.Run(ctx, identitycommand.PrimaryGroupTool, identitycommand.PrimaryGroupArguments()); result.ExitCode != 0 {
		return fail("primary_group_creation_failed")
	}
	createdPrimary = true
	primaryID, _ = preparation.groupID(identitystate.PrimaryGroup)
	if !preparation.verifyGroup(identitystate.PrimaryGroup, false) || !preparation.updateJournal(&journal, identitystate.ResourcePrimaryGroup) {
		return fail("primary_group_verification_failed")
	}
	if result := preparation.deps.Executor.Run(ctx, identitycommand.HelperGroupTool, identitycommand.HelperGroupArguments()); result.ExitCode != 0 {
		return fail("helper_group_creation_failed")
	}
	createdHelper = true
	helperID, _ = preparation.groupID(identitystate.HelperGroup)
	if !preparation.verifyGroup(identitystate.HelperGroup, false) || !preparation.updateJournal(&journal, identitystate.ResourceHelperGroup) {
		return fail("helper_group_verification_failed")
	}
	if result := preparation.deps.Executor.Run(ctx, identitycommand.UserTool, identitycommand.UserArguments(readiness.Capabilities)); result.ExitCode != 0 {
		return fail("runtime_user_creation_failed")
	}
	createdUser = true
	identity, verifyErr := preparation.currentIdentity()
	createdIdentity = identity
	passwordCheck := preparation.inspectPasswordState(identitystate.ExactUnmanaged)
	if verifyErr != nil || passwordCheck.Status != identityreport.Passed || preparation.deps.Exists(preparation.paths.RuntimeHome) || preparation.anyPathExists(preparation.paths.MailSpoolPaths) || !preparation.baselineMatches(baseline) || !preparation.updateJournal(&journal, identitystate.ResourceRuntimeUser) {
		if !preparation.baselineMatches(baseline) {
			return fail("login_log_artifact_changed")
		}
		return fail("runtime_user_verification_failed")
	}
	state := identitystate.ManagedState{SchemaVersion: identitystate.SchemaVersion, Status: "prepared", RuntimeUser: identitystate.Resource{Name: identitystate.RuntimeUser, ID: identity.UserID}, PrimaryGroup: identitystate.GroupResource{Name: identitystate.PrimaryGroup, ID: identity.PrimaryGroupID}, HelperGroup: identitystate.GroupResource{Name: identitystate.HelperGroup, ID: identity.HelperGroupID}, SourceCommit: commit, BundleVersion: version}
	if err := identitystate.WriteState(preparation.paths.StateDirectory, preparation.paths.StateFile, state); err != nil {
		return fail("managed_state_write_failed")
	}
	if err := identitystate.RemoveJournal(preparation.paths.Journal); err != nil {
		return preparation.failureReport(PrepareDisabled, preparation.inspectSnapshot(), "preparation_failed_recovery_required"), nil
	}
	preparation.releaseLock(lock)
	lockReleased = true
	result := preparation.inspectSnapshot()
	result.loginLogCheck = snapshot.loginLogCheck
	report := preparation.report(PrepareDisabled, result)
	report.Result = "prepared"
	return report, nil
}

func (preparation Preparation) rollback(ctx context.Context, user, helper, primary bool, expected runtimeidentity.Identity, primaryID, helperID int, baseline loginLogBaseline) bool {
	if user {
		identity, err := preparation.currentIdentity()
		if err != nil || identity != expected || preparation.deps.Executor.Run(ctx, identitycommand.UserDeleteTool, identitycommand.UserDeleteArguments()).ExitCode != 0 {
			return false
		}
	}
	if helper {
		id, ok := preparation.groupID(identitystate.HelperGroup)
		if !ok || id != helperID || !preparation.verifyGroup(identitystate.HelperGroup, false) || preparation.deps.Executor.Run(ctx, identitycommand.GroupDeleteTool, identitycommand.HelperGroupDeleteArguments()).ExitCode != 0 {
			return false
		}
	}
	if primary {
		id, ok := preparation.groupID(identitystate.PrimaryGroup)
		if !ok || id != primaryID || !preparation.verifyGroup(identitystate.PrimaryGroup, false) || preparation.deps.Executor.Run(ctx, identitycommand.GroupDeleteTool, identitycommand.PrimaryGroupDeleteArguments()).ExitCode != 0 {
			return false
		}
	}
	return preparation.verifyRollbackArtifacts(false, baseline, true)
}

func (preparation Preparation) verifyRollbackArtifacts(journalAbsent bool, baseline loginLogBaseline, lockMayBeHeld bool) bool {
	passwd, passwdErr := preparation.deps.ReadFile(preparation.paths.Passwd)
	group, groupErr := preparation.deps.ReadFile(preparation.paths.Group)
	if passwdErr != nil || groupErr != nil {
		return false
	}
	state, _, _ := identitystate.Classify(string(passwd), string(group), nil, false)
	if state != identitystate.Absent || preparation.groupExists(identitystate.PrimaryGroup) || preparation.groupExists(identitystate.HelperGroup) {
		return false
	}
	if preparation.inspectPasswordState(identitystate.Absent).Status != identityreport.NotApplicable {
		return false
	}
	if preparation.accountFileHasNames(preparation.paths.GShadow, []string{identitystate.PrimaryGroup, identitystate.HelperGroup}) {
		return false
	}
	for _, path := range []string{preparation.paths.RuntimeHome, preparation.paths.ApplicationState, preparation.paths.StateFile, preparation.paths.StateFile + ".candidate", preparation.paths.Journal + ".candidate"} {
		if preparation.deps.Exists(path) {
			return false
		}
	}
	for _, path := range preparation.paths.MailSpoolPaths {
		if preparation.deps.Exists(path) {
			return false
		}
	}
	if !preparation.baselineMatches(baseline) {
		return false
	}
	if journalAbsent && preparation.deps.Exists(preparation.paths.Journal) {
		return false
	}
	if !lockMayBeHeld && preparation.deps.Exists(preparation.paths.Lock) {
		return false
	}
	return true
}

func (preparation Preparation) retainRecoveryJournal(journal identitystate.Journal) error {
	journal.Status = "in_progress"
	return identitystate.WriteJournal(preparation.paths.StateDirectory, preparation.paths.Journal, journal)
}

func (preparation Preparation) groupExists(name string) bool {
	data, err := preparation.deps.ReadFile(preparation.paths.Group)
	if err != nil {
		return true
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) > 0 && fields[0] == name {
			return true
		}
	}
	return false
}

func (preparation Preparation) accountFileHasNames(path string, names []string) bool {
	if !preparation.deps.Exists(path) {
		return false
	}
	data, err := preparation.deps.ReadFile(path)
	if err != nil {
		return true
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		for _, name := range names {
			if len(fields) > 0 && fields[0] == name {
				return true
			}
		}
	}
	return false
}

func (preparation Preparation) anyPathExists(paths []string) bool {
	for _, path := range paths {
		if preparation.deps.Exists(path) {
			return true
		}
	}
	return false
}

func (preparation Preparation) updateJournal(journal *identitystate.Journal, step string) bool {
	journal.Steps = append(journal.Steps, step)
	return identitystate.WriteJournal(preparation.paths.StateDirectory, preparation.paths.Journal, *journal) == nil
}

func (preparation Preparation) currentIdentity() (runtimeidentity.Identity, error) {
	passwd, passwdErr := preparation.deps.ReadFile(preparation.paths.Passwd)
	group, groupErr := preparation.deps.ReadFile(preparation.paths.Group)
	if passwdErr != nil || groupErr != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("account_database_unsafe")
	}
	state, identity, err := runtimeidentity.ClassifyAccountContract(string(passwd), string(group))
	if err != nil || state != runtimeidentity.Ready || !preparation.verifyGroup(identitystate.HelperGroup, false) {
		return runtimeidentity.Identity{}, fmt.Errorf("runtime_user_verification_failed")
	}
	return identity, nil
}

func (preparation Preparation) verifyGroup(name string, requireMembers bool) bool {
	_, ok := preparation.groupID(name)
	if !ok {
		return false
	}
	data, err := preparation.deps.ReadFile(preparation.paths.Group)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) != 4 || fields[0] != name {
			continue
		}
		if !requireMembers && fields[3] != "" {
			return false
		}
	}
	return true
}

func (preparation Preparation) groupID(name string) (int, bool) {
	data, err := preparation.deps.ReadFile(preparation.paths.Group)
	if err != nil {
		return 0, false
	}
	count := 0
	value := 0
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) != 4 || fields[0] != name {
			continue
		}
		count++
		parsed, parseErr := strconv.Atoi(fields[2])
		if parseErr != nil || parsed <= 0 || (len(fields[2]) > 1 && fields[2][0] == '0') {
			return 0, false
		}
		value = parsed
	}
	return value, count == 1 && value > 0
}

func (preparation Preparation) acquireLock() (*os.File, error) {
	file, err := os.OpenFile(preparation.paths.Lock, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(preparation.paths.Lock)
		return nil, err
	}
	return file, nil
}

func (preparation Preparation) releaseLock(file *os.File) {
	if file == nil {
		return
	}
	_ = file.Sync()
	_ = file.Close()
	_ = os.Remove(preparation.paths.Lock)
}

func (preparation Preparation) report(action Action, snapshot snapshot) identityreport.Report {
	result := "blocked"
	switch snapshot.state {
	case identitystate.Absent:
		result = "absent"
	case identitystate.ManagedPrepared:
		result = "managed_prepared"
	case identitystate.ExactUnmanaged:
		result = "exact_unmanaged"
	case identitystate.Interrupted:
		result = "interrupted"
	}
	if result == string(identitystate.Absent) && action == VerifyManaged {
		result = "blocked"
	}
	return identityreport.Report{SchemaVersion: qualificationreport.SchemaVersion, Action: string(action), Result: result, IdentityState: string(snapshot.state), ManagedState: snapshot.stateCheck, Transaction: snapshot.journalCheck, Checks: []identityreport.Check{snapshot.identityCheck, snapshot.deploymentCheck, snapshot.helperCheck, snapshot.lockCheck, snapshot.passwordCheck, snapshot.loginLogCheck}}
}

func (preparation Preparation) failureReport(action Action, snapshot snapshot, code string) identityreport.Report {
	result := "blocked"
	if strings.HasSuffix(code, "_rolled_back") {
		result = "preparation_failed_rolled_back"
	} else if strings.HasSuffix(code, "_recovery_required") {
		result = "preparation_failed_recovery_required"
	}
	return identityreport.Report{SchemaVersion: qualificationreport.SchemaVersion, Action: string(action), Result: result, IdentityState: string(snapshot.state), ManagedState: snapshot.stateCheck, Transaction: check("transaction", identityreport.Blocked, code), Checks: []identityreport.Check{snapshot.identityCheck, snapshot.deploymentCheck, snapshot.helperCheck, snapshot.lockCheck, snapshot.passwordCheck, snapshot.loginLogCheck}}
}

func identityCheck(code string, status identityreport.Status) identityreport.Check {
	return check("identity_state", status, code)
}
func identityStatus(state identitystate.State) identityreport.Status {
	if state == identitystate.Absent {
		return identityreport.Warning
	}
	if state == identitystate.ManagedPrepared {
		return identityreport.Passed
	}
	return identityreport.Blocked
}
func check(name string, status identityreport.Status, code string) identityreport.Check {
	return identityreport.Check{Name: name, Status: status, Code: code}
}

func (preparation Preparation) inspectPasswordState(state identitystate.State) identityreport.Check {
	if !preparation.deps.Exists(preparation.paths.Shadow) {
		if state == identitystate.Absent {
			return check("runtime_password", identityreport.NotApplicable, "runtime_password_absent")
		}
		return check("runtime_password", identityreport.Blocked, "runtime_password_missing")
	}
	if err := preparation.deps.ValidateAccountFile(preparation.paths.Shadow); err != nil {
		return check("runtime_password", identityreport.Blocked, "account_database_unsafe")
	}
	data, err := preparation.deps.ReadFile(preparation.paths.Shadow)
	if err != nil {
		return check("runtime_password", identityreport.Blocked, "account_database_unsafe")
	}
	count := 0
	locked := false
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(line, ":")
		if len(fields) == 0 || fields[0] != runtimeidentity.RuntimeUser {
			continue
		}
		count++
		if len(fields) >= 2 && (strings.HasPrefix(fields[1], "!") || strings.HasPrefix(fields[1], "*")) {
			locked = true
		}
	}
	if state == identitystate.Absent {
		if count == 0 {
			return check("runtime_password", identityreport.NotApplicable, "runtime_password_absent")
		}
		return check("runtime_password", identityreport.Blocked, "runtime_password_residual")
	}
	if count == 0 {
		return check("runtime_password", identityreport.Blocked, "runtime_password_missing")
	}
	if count > 1 {
		return check("runtime_password", identityreport.Blocked, "runtime_password_duplicate")
	}
	if !locked {
		return check("runtime_password", identityreport.Blocked, "runtime_password_unlocked")
	}
	return check("runtime_password", identityreport.Passed, "runtime_password_locked")
}

func (preparation Preparation) blockedSnapshot(code string) snapshot {
	return snapshot{
		state:           identitystate.Unsafe,
		identityCheck:   identityCheck(code, identityreport.Blocked),
		stateCheck:      check("managed_state", identityreport.NotApplicable, "managed_state_not_inspected"),
		journalCheck:    check("transaction", identityreport.NotApplicable, "transaction_not_inspected"),
		deploymentCheck: check("deployment", identityreport.NotApplicable, "deployment_not_inspected"),
		helperCheck:     check("helper_installation", identityreport.NotApplicable, "helper_not_inspected"),
		lockCheck:       check("preparation_lock", identityreport.NotApplicable, "lock_not_inspected"),
		passwordCheck:   check("runtime_password", identityreport.NotApplicable, "password_not_inspected"),
		loginLogCheck:   check("login_log_strategy", identityreport.NotApplicable, "login_log_strategy_not_inspected"),
	}
}

func validateTool(path string) error {
	for _, parent := range []string{"/usr", "/usr/sbin"} {
		info, err := os.Lstat(parent)
		if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 || fileUID(info) != 0 {
			return fmt.Errorf("account_tool_unsafe")
		}
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o111 == 0 || info.Mode().Perm()&0o022 != 0 || fileUID(info) != 0 {
		return fmt.Errorf("account_tool_unsafe")
	}
	return nil
}

func validateLoginLogExecutable(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0 && info.Mode().Perm()&0o111 != 0 && info.Mode().Perm()&0o022 == 0 && fileUID(info) == expectedExternalUID() && fileNlink(info) == 1
}

func validateAccountFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 || fileUID(info) != 0 || fileNlink(info) != 1 || info.Size() > 1<<20 {
		return fmt.Errorf("account_database_unsafe")
	}
	return nil
}

func validateDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 || fileUID(info) != 0 {
		return fmt.Errorf("account_database_unsafe")
	}
	return nil
}

func validatePrivatePath(path string) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o600 || fileUID(info) != 0 || fileNlink(info) != 1 {
		return fmt.Errorf("private_path_unsafe")
	}
	return nil
}

func bundleMetadata(root string) (string, string, error) {
	data, err := os.ReadFile(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		return "", "", err
	}
	value, err := manifest.Decode(data)
	if err != nil {
		return "", "", err
	}
	return value.SourceCommit, value.Version, nil
}

func fileUID(info os.FileInfo) uint32 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return stats.Uid
	}
	return ^uint32(0)
}

func fileNlink(info os.FileInfo) uint64 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(stats.Nlink)
	}
	return 0
}
