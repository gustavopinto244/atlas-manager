package runtimeconfiguration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitystate"
	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

const (
	InstallConfirmation = "confirm_atlas_manager_mock_runtime_configuration"
	RemoveConfirmation  = "confirm_atlas_manager_mock_runtime_configuration_removal"
)

type Action string

const (
	Inspect     Action = "inspect"
	InstallMock Action = "install-mock"
	VerifyMock  Action = "verify-mock"
	RemoveMock  Action = "remove-mock"
)

func ValidAction(value string) bool {
	return value == string(Inspect) || value == string(InstallMock) || value == string(VerifyMock) || value == string(RemoveMock)
}

type Paths struct {
	BundleRoot        string
	Passwd            string
	Group             string
	Environment       string
	ConfigDir         string
	StateDirectory    string
	StateFile         string
	Journal           string
	Lock              string
	Deployment        installer.Paths
	IdentityState     string
	IdentityJournal   string
	RuntimeActivity   string
	ServiceEnablement string
}

func ProductionPaths(bundleRoot string) Paths {
	deployment := installer.ProductionPaths()
	return Paths{
		BundleRoot: bundleRoot, Passwd: "/etc/passwd", Group: "/etc/group", Environment: "/etc/atlas-manager/atlas-manager.env", ConfigDir: "/etc/atlas-manager",
		StateDirectory: "/var/lib/atlas-manager-runtime-configuration", StateFile: "/var/lib/atlas-manager-runtime-configuration/state.json",
		Journal: "/var/lib/atlas-manager-runtime-configuration/transaction.json", Lock: "/run/atlas-manager-runtime-configuration.lock",
		Deployment: deployment, IdentityState: "/var/lib/atlas-manager-identity-preparation/state.json",
		IdentityJournal: "/var/lib/atlas-manager-identity-preparation/transaction.json", RuntimeActivity: deployment.RuntimeDir,
		ServiceEnablement: deployment.EnableLink,
	}
}

type Dependencies struct {
	EffectiveUID   func() int
	Platform       func() string
	Architecture   func() string
	ApplyOwnership bool
	Now            func() time.Time
}

type Report struct {
	SchemaVersion int     `json:"schemaVersion"`
	Action        string  `json:"action"`
	Result        string  `json:"result"`
	Profile       string  `json:"profile"`
	Configuration Check   `json:"configuration"`
	Deployment    Check   `json:"deployment"`
	Identity      Check   `json:"identity"`
	Service       Check   `json:"service"`
	Transaction   Check   `json:"transaction"`
	Checks        []Check `json:"checks"`
}

type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Code   string `json:"code"`
}

type Configuration struct {
	paths Paths
	deps  Dependencies
}

func New(paths Paths, deps Dependencies) Configuration {
	if deps.EffectiveUID == nil {
		deps.EffectiveUID = os.Geteuid
	}
	if deps.Platform == nil {
		deps.Platform = func() string { return runtime.GOOS }
	}
	if deps.Architecture == nil {
		deps.Architecture = func() string { return runtime.GOARCH }
	}
	if deps.Now == nil {
		deps.Now = time.Now
	}
	return Configuration{paths: paths, deps: deps}
}

func (configuration Configuration) Run(ctx context.Context, action Action, confirmation string) (Report, error) {
	if !ValidAction(string(action)) {
		return Report{}, fmt.Errorf("action_invalid")
	}
	if configuration.deps.EffectiveUID() != 0 {
		return configuration.blocked(action, "effective_root_required"), nil
	}
	if configuration.deps.Platform() != "linux" || configuration.deps.Architecture() != "amd64" {
		return configuration.blocked(action, "unsupported_platform"), nil
	}
	report := configuration.inspect(action)
	if action == Inspect {
		return report, nil
	}
	if action == InstallMock && confirmation != InstallConfirmation {
		return configuration.blocked(action, "confirmation_invalid"), nil
	}
	if action == RemoveMock && confirmation != RemoveConfirmation {
		return configuration.blocked(action, "confirmation_invalid"), nil
	}
	if err := configuration.validatePrerequisites(); err != nil {
		return configuration.blocked(action, errorCode(err)), nil
	}
	if action == VerifyMock {
		state, seen, err := ReadState(configuration.paths.StateFile)
		if err != nil || !seen {
			return configuration.blocked(action, "configuration_absent"), nil
		}
		if err := configuration.verifyInstalled(state); err != nil {
			return configuration.blocked(action, errorCode(err)), nil
		}
		return configuration.report(action, "verified_mock"), nil
	}
	if action == InstallMock {
		if _, seen, err := ReadState(configuration.paths.StateFile); seen || err != nil {
			return configuration.blocked(action, "configuration_state_invalid"), nil
		}
		if _, seen, err := readJournal(configuration.paths.Journal); seen || err != nil {
			return configuration.blocked(action, "configuration_journal_present"), nil
		}
	} else if _, seen, err := readJournal(configuration.paths.Journal); seen || err != nil {
		return configuration.blocked(action, "configuration_journal_present"), nil
	}
	lock, err := acquireLock(configuration.paths.Lock, configuration.deps.ApplyOwnership)
	if err != nil {
		return configuration.blocked(action, errorCode(err)), nil
	}
	defer releaseLock(lock, configuration.paths.Lock)
	if action == InstallMock {
		return configuration.install(ctx)
	}
	return configuration.remove(ctx)
}

func (configuration Configuration) inspect(action Action) Report {
	report := Report{SchemaVersion: 1, Action: string(action), Result: "blocked", Profile: ProfileName,
		Configuration: Check{Name: "configuration", Status: "blocked", Code: "configuration_absent"},
		Deployment:    Check{Name: "deployment", Status: "blocked", Code: "deployment_not_ready"},
		Identity:      Check{Name: "identity", Status: "blocked", Code: "identity_not_ready"},
		Service:       Check{Name: "service", Status: "blocked", Code: "service_active_or_enabled"},
		Transaction:   Check{Name: "transaction", Status: "passed", Code: "configuration_transaction_absent"}}
	if _, seen, err := ReadState(configuration.paths.StateFile); err == nil && seen {
		report.Configuration = Check{Name: "configuration", Status: "passed", Code: "configuration_managed"}
		report.Result = "installed_mock"
	}
	if _, err := os.Lstat(configuration.paths.Environment); os.IsNotExist(err) {
		report.Configuration = Check{Name: "configuration", Status: "warning", Code: "configuration_absent"}
	}
	if _, seen, err := readJournal(configuration.paths.Journal); seen || err != nil {
		report.Transaction = Check{Name: "transaction", Status: "blocked", Code: "configuration_journal_present"}
		report.Result = "interrupted"
	}
	if report.Result == "blocked" && report.Configuration.Code == "configuration_absent" && report.Transaction.Status == "passed" {
		report.Result = "absent"
	}
	if err := configuration.validatePrerequisites(); err == nil {
		report.Deployment = Check{Name: "deployment", Status: "passed", Code: "deployment_ready"}
		report.Identity = Check{Name: "identity", Status: "passed", Code: "identity_ready"}
		report.Service = Check{Name: "service", Status: "passed", Code: "service_inactive_disabled"}
	}
	return report
}

func (configuration Configuration) install(ctx context.Context) (Report, error) {
	if err := writeJournal(configuration.paths, "in_progress"); err != nil {
		return configuration.blocked(InstallMock, errorCode(err)), nil
	}
	if _, err := os.Lstat(configuration.paths.Environment); err == nil {
		return configuration.blocked(InstallMock, "configuration_existing_unknown"), nil
	} else if !os.IsNotExist(err) {
		return configuration.blocked(InstallMock, "configuration_unsafe"), nil
	}
	identity, err := loadManagedIdentity(configuration.paths)
	if err != nil {
		return configuration.blocked(InstallMock, errorCode(err)), nil
	}
	if err := writeConfiguration(configuration.paths, identity.PrimaryGroupID, configuration.deps.ApplyOwnership); err != nil {
		return configuration.blocked(InstallMock, errorCode(err)), nil
	}
	value, err := bundleMetadata(configuration.paths.BundleRoot)
	if err != nil {
		_ = os.Remove(configuration.paths.Environment)
		return configuration.blocked(InstallMock, "bundle_invalid"), nil
	}
	state := State{SchemaVersion: StateSchemaVersion, Profile: ProfileName, ConfigurationSHA256: ProfileSHA256(), ApplicationVersion: value.Version, SourceCommit: value.SourceCommit, Status: "installed"}
	if err := WriteState(configuration.paths.StateDirectory, configuration.paths.StateFile, state); err != nil {
		_ = os.Remove(configuration.paths.Environment)
		return configuration.blocked(InstallMock, errorCode(err)), nil
	}
	if err := configuration.verifyInstalled(state); err != nil {
		return configuration.blocked(InstallMock, errorCode(err)), nil
	}
	if err := os.Remove(configuration.paths.Journal); err != nil {
		return configuration.blocked(InstallMock, "configuration_journal_remove_failed"), nil
	}
	return configuration.report(InstallMock, "installed_mock"), nil
}

func (configuration Configuration) remove(ctx context.Context) (Report, error) {
	state, seen, err := ReadState(configuration.paths.StateFile)
	if err != nil || !seen {
		return configuration.blocked(RemoveMock, "configuration_state_invalid"), nil
	}
	if err := configuration.verifyInstalled(state); err != nil {
		return configuration.blocked(RemoveMock, errorCode(err)), nil
	}
	if err := writeJournal(configuration.paths, "in_progress"); err != nil {
		return configuration.blocked(RemoveMock, errorCode(err)), nil
	}
	if err := os.Remove(configuration.paths.Environment); err != nil {
		return configuration.blocked(RemoveMock, "configuration_remove_failed"), nil
	}
	if err := RemoveState(configuration.paths.StateFile); err != nil {
		return configuration.blocked(RemoveMock, errorCode(err)), nil
	}
	if err := os.Remove(configuration.paths.Journal); err != nil {
		return configuration.blocked(RemoveMock, "configuration_journal_remove_failed"), nil
	}
	return configuration.report(RemoveMock, "removed"), nil
}

func (configuration Configuration) validatePrerequisites() error {
	if !safeDirectory(configuration.paths.ConfigDir) {
		return fmt.Errorf("configuration_unsafe")
	}
	if err := installer.InspectBundleReadOnly(configuration.paths.BundleRoot); err != nil {
		return fmt.Errorf("bundle_invalid")
	}
	if _, err := os.Stat(configuration.paths.Deployment.Current); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	identity, err := loadManagedIdentity(configuration.paths)
	if err != nil {
		return err
	}
	if err := validateDirectoryMetadata(configuration.paths.ConfigDir, identity.PrimaryGroupID, configuration.deps.ApplyOwnership); err != nil {
		return err
	}
	if err := installer.VerifyManagedDisabled(configuration.paths.Deployment, identity, configuration.deps.ApplyOwnership); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	if _, err := os.Lstat(configuration.paths.Deployment.EnableLink); err == nil {
		return fmt.Errorf("service_enabled")
	}
	if _, err := os.Lstat(configuration.paths.RuntimeActivity); err == nil {
		return fmt.Errorf("service_active")
	}
	if _, seen, err := readJournal(configuration.paths.Journal); seen || err != nil {
		return fmt.Errorf("configuration_journal_present")
	}
	return nil
}

func (configuration Configuration) verifyInstalled(state State) error {
	if err := ValidateState(state); err != nil {
		return err
	}
	identity, err := loadManagedIdentity(configuration.paths)
	if err != nil {
		return err
	}
	if err := validateDirectoryMetadata(configuration.paths.ConfigDir, identity.PrimaryGroupID, configuration.deps.ApplyOwnership); err != nil {
		return err
	}
	data, err := os.ReadFile(configuration.paths.Environment)
	if err != nil || ValidateProfile(data) != nil {
		return fmt.Errorf("configuration_modified")
	}
	if hashBytes(data) != state.ConfigurationSHA256 {
		return fmt.Errorf("configuration_modified")
	}
	if err := validateMetadata(configuration.paths.Environment, 0o640, identity.PrimaryGroupID, configuration.deps.ApplyOwnership); err != nil {
		return err
	}
	return nil
}

func (configuration Configuration) report(action Action, result string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: result, Profile: ProfileName, Configuration: Check{Name: "configuration", Status: "passed", Code: result}, Deployment: Check{Name: "deployment", Status: "passed", Code: "deployment_ready"}, Identity: Check{Name: "identity", Status: "passed", Code: "identity_ready"}, Service: Check{Name: "service", Status: "passed", Code: "service_inactive_disabled"}, Transaction: Check{Name: "transaction", Status: "passed", Code: "configuration_transaction_absent"}}
}
func (configuration Configuration) blocked(action Action, code string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: "blocked", Profile: ProfileName, Configuration: Check{Name: "configuration", Status: "blocked", Code: code}, Transaction: Check{Name: "transaction", Status: "blocked", Code: code}}
}

func (report Report) Marshal() ([]byte, error) {
	data, err := json.Marshal(report)
	if err != nil || len(data)+1 > 64*1024 {
		return nil, fmt.Errorf("configuration_report_invalid")
	}
	return append(data, '\n'), nil
}

func writeConfiguration(paths Paths, primaryGroupID int, ownership bool) error {
	data := ProfileBytes()
	temporary := paths.Environment + ".candidate"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return fmt.Errorf("configuration_write_failed")
	}
	if _, err := file.Write(data); err != nil || file.Sync() != nil || file.Close() != nil {
		_ = file.Close()
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_write_failed")
	}
	if ownership {
		if err := os.Chown(temporary, 0, primaryGroupID); err != nil {
			_ = os.Remove(temporary)
			return fmt.Errorf("configuration_write_failed")
		}
	}
	if err := os.Chmod(temporary, 0o640); err != nil || os.Rename(temporary, paths.Environment) != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_write_failed")
	}
	return nil
}

func loadManagedIdentity(paths Paths) (runtimeidentity.Identity, error) {
	passwd, err := os.ReadFile(paths.Passwd)
	if err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	group, err := os.ReadFile(paths.Group)
	if err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	identity, err := runtimeidentity.ValidateAccountContract(string(passwd), string(group))
	if err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	state, seen, err := identitystate.ReadState(paths.IdentityState)
	if err != nil || !seen || state.RuntimeUser.ID != identity.UserID || state.PrimaryGroup.ID != identity.PrimaryGroupID || state.HelperGroup.ID != identity.HelperGroupID {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	if _, seen, err := identitystate.ReadJournal(paths.IdentityJournal); seen || err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	return identity, nil
}

func bundleMetadata(root string) (manifest.Manifest, error) {
	data, err := os.ReadFile(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		return manifest.Manifest{}, err
	}
	return manifest.Decode(data)
}
func hashBytes(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}
func errorCode(err error) string {
	if err == nil {
		return "blocked"
	}
	return err.Error()
}

func validateMetadata(path string, mode os.FileMode, gid int, ownership bool) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != mode || fileNlink(info) != 1 {
		return fmt.Errorf("configuration_unsafe")
	}
	if ownership && (fileUID(info) != 0 || fileGID(info) != uint32(gid)) {
		return fmt.Errorf("configuration_unsafe")
	}
	return nil
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
func fileNlink(info os.FileInfo) uint64 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return uint64(stats.Nlink)
	}
	return 0
}

func writeJournal(paths Paths, status string) error {
	data := []byte(fmt.Sprintf("{\"schemaVersion\":1,\"status\":\"%s\"}\n", status))
	if err := os.MkdirAll(paths.StateDirectory, 0o700); err != nil {
		return fmt.Errorf("configuration_journal_write_failed")
	}
	temporary := paths.Journal + ".candidate"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return fmt.Errorf("configuration_journal_write_failed")
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_journal_write_failed")
	}
	if err := os.Rename(temporary, paths.Journal); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_journal_write_failed")
	}
	return nil
}
func readJournal(path string) (bool, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return false, false, nil
	}
	if err != nil || len(data) > 1024 {
		return true, true, fmt.Errorf("configuration_journal_invalid")
	}
	var value struct {
		SchemaVersion int    `json:"schemaVersion"`
		Status        string `json:"status"`
	}
	if decodeStrict(data, &value) != nil || value.SchemaVersion != 1 || value.Status != "in_progress" {
		return true, true, fmt.Errorf("configuration_journal_invalid")
	}
	return true, true, nil
}
func acquireLock(path string, ownership bool) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("configuration_lock_failed")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("configuration_lock_conflict")
	}
	if ownership {
		_ = file.Chown(0, 0)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, fmt.Errorf("configuration_lock_conflict")
	}
	return file, nil
}
func releaseLock(file *os.File, path string) {
	if file != nil {
		_ = file.Close()
	}
	_ = os.Remove(path)
}

func safeDirectory(path string) bool {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0o022 != 0 {
		return false
	}
	return true
}

func validateDirectoryMetadata(path string, gid int, ownership bool) error {
	info, err := os.Lstat(path)
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0o750 {
		return fmt.Errorf("configuration_unsafe")
	}
	if ownership && (fileUID(info) != 0 || fileGID(info) != uint32(gid)) {
		return fmt.Errorf("configuration_unsafe")
	}
	return nil
}
