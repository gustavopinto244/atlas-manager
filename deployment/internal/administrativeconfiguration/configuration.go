package administrativeconfiguration

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitystate"
	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

type Action string

const (
	Inspect             Action = "inspect"
	ValidateInputAction Action = "validate-input"
	InstallDisabled     Action = "install-disabled"
	VerifyInstalled     Action = "verify-installed"
	RemoveDisabled      Action = "remove-disabled"
)

const (
	InstallConfirmation = "confirm_atlas_manager_mock_administrative_configuration"
	RemoveConfirmation  = "confirm_atlas_manager_mock_administrative_configuration_removal"
)

type Paths struct {
	BundleRoot, Input, Environment, ConfigDir string
	StateDirectory, StateFile, Journal, Lock  string
	Deployment                                installer.Paths
	IdentityState, IdentityJournal            string
}

func ProductionPaths(bundleRoot string) Paths {
	deployment := installer.ProductionPaths()
	return Paths{
		BundleRoot: bundleRoot, Input: filepath.Join(bundleRoot, InputName),
		Environment: "/etc/atlas-manager/atlas-manager.env", ConfigDir: "/etc/atlas-manager",
		StateDirectory:  "/var/lib/atlas-manager-administrative-runtime-configuration",
		StateFile:       "/var/lib/atlas-manager-administrative-runtime-configuration/state.json",
		Journal:         "/var/lib/atlas-manager-administrative-runtime-configuration/transaction.json",
		Lock:            "/run/atlas-manager-administrative-runtime-configuration.lock",
		Deployment:      deployment,
		IdentityState:   "/var/lib/atlas-manager-identity-preparation/state.json",
		IdentityJournal: "/var/lib/atlas-manager-identity-preparation/transaction.json",
	}
}

type Dependencies struct {
	EffectiveUID   func() int
	Platform       func() string
	Architecture   func() string
	ApplyOwnership bool
}

type Check struct{ Name, Status, Code string }
type Report struct {
	SchemaVersion int     `json:"schemaVersion"`
	Action        string  `json:"action"`
	Result        string  `json:"result"`
	Profile       string  `json:"profile"`
	Configuration Check   `json:"configuration"`
	Deployment    Check   `json:"deployment"`
	Identity      Check   `json:"identity"`
	Transaction   Check   `json:"transaction"`
	Checks        []Check `json:"checks"`
}

type State struct {
	SchemaVersion       int    `json:"schemaVersion"`
	Profile             string `json:"profile"`
	ConfigurationSHA256 string `json:"configurationSha256"`
	ApplicationVersion  string `json:"applicationVersion"`
	SourceCommit        string `json:"sourceCommit"`
	Status              string `json:"status"`
}

type journal struct {
	SchemaVersion int      `json:"schemaVersion"`
	Status        string   `json:"status"`
	Profile       string   `json:"profile"`
	Steps         []string `json:"completedSteps"`
}

func ValidAction(value string) bool {
	return value == string(Inspect) || value == string(ValidateInputAction) || value == string(InstallDisabled) || value == string(VerifyInstalled) || value == string(RemoveDisabled)
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
	return Configuration{paths: paths, deps: deps}
}

type Configuration struct {
	paths Paths
	deps  Dependencies
}

func (configuration Configuration) Run(ctx context.Context, action Action, confirmation string) (Report, error) {
	_ = ctx
	if !ValidAction(string(action)) {
		return Report{}, fmt.Errorf("action_invalid")
	}
	if configuration.deps.EffectiveUID() != 0 {
		return configuration.blocked(action, "effective_root_required"), nil
	}
	if configuration.deps.Platform() != "linux" || configuration.deps.Architecture() != "amd64" {
		return configuration.blocked(action, "unsupported_platform"), nil
	}
	if action == ValidateInputAction {
		if _, err := configuration.readInput(); err != nil {
			return configuration.blocked(action, "administrative_input_invalid"), nil
		}
		return configuration.success(action, "valid_input"), nil
	}
	if action == Inspect {
		return configuration.inspect(), nil
	}
	if action == InstallDisabled && confirmation != InstallConfirmation {
		return configuration.blocked(action, "confirmation_invalid"), nil
	}
	if action == RemoveDisabled && confirmation != RemoveConfirmation {
		return configuration.blocked(action, "confirmation_invalid"), nil
	}
	if action == VerifyInstalled {
		if err := configuration.validateBase(); err != nil {
			return configuration.blocked(action, err.Error()), nil
		}
		if err := configuration.verifyInstalled(); err != nil {
			return configuration.blocked(action, err.Error()), nil
		}
		return configuration.success(action, "verified_installed"), nil
	}
	if action == RemoveDisabled {
		if err := configuration.validateBase(); err != nil {
			return configuration.blocked(action, err.Error()), nil
		}
		if err := configuration.verifyInstalled(); err != nil {
			return configuration.blocked(action, err.Error()), nil
		}
	} else if err := configuration.validatePrerequisites(); err != nil {
		return configuration.blocked(action, err.Error()), nil
	}
	if _, seen, err := readState(configuration.paths.StateFile); seen || err != nil {
		return configuration.blocked(action, "configuration_state_invalid"), nil
	}
	if _, seen, err := readJournal(configuration.paths.Journal); seen || err != nil {
		return configuration.blocked(action, "configuration_journal_present"), nil
	}
	lock, err := acquireLock(configuration.paths.Lock, configuration.deps.ApplyOwnership)
	if err != nil {
		return configuration.blocked(action, err.Error()), nil
	}
	defer releaseLock(lock, configuration.paths.Lock)
	if action == InstallDisabled {
		return configuration.install(), nil
	}
	return configuration.remove(), nil
}

func (configuration Configuration) inspect() Report {
	if _, seen, err := readJournal(configuration.paths.Journal); seen || err != nil {
		return configuration.blocked(Inspect, "configuration_journal_present")
	}
	if _, seen, err := readState(configuration.paths.StateFile); seen && err == nil {
		return configuration.success(Inspect, "installed")
	}
	if _, err := os.Lstat(configuration.paths.Environment); err == nil {
		return configuration.blocked(Inspect, "configuration_existing_unknown")
	}
	if _, err := configuration.readInput(); err != nil {
		return configuration.blocked(Inspect, "administrative_input_invalid")
	}
	return configuration.success(Inspect, "absent")
}

func (configuration Configuration) validatePrerequisites() error {
	if _, err := configuration.readInput(); err != nil {
		return err
	}
	if err := installer.InspectBundleReadOnly(configuration.paths.BundleRoot); err != nil {
		return fmt.Errorf("bundle_invalid")
	}
	if _, err := os.Stat(configuration.paths.Deployment.Current); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	if _, err := os.Lstat(configuration.paths.Deployment.EnableLink); err == nil {
		return fmt.Errorf("service_enabled")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("service_state_unsafe")
	}
	if _, err := os.Lstat(configuration.paths.Deployment.RuntimeDir); err == nil {
		return fmt.Errorf("service_active")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("service_state_unsafe")
	}
	if _, err := os.Lstat(configuration.paths.Environment); err == nil {
		return fmt.Errorf("configuration_existing_unknown")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("configuration_unsafe")
	}
	identity, err := configuration.identity()
	if err != nil {
		return err
	}
	if err := installer.VerifyManagedDisabled(configuration.paths.Deployment, identity, configuration.deps.ApplyOwnership); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	if state, seen, stateErr := identitystate.ReadState(configuration.paths.IdentityState); stateErr != nil || !seen || state == nil || state.RuntimeUser.ID != identity.UserID {
		return fmt.Errorf("identity_not_ready")
	}
	return nil
}

func (configuration Configuration) install() Report {
	input, err := configuration.readInput()
	if err != nil {
		return configuration.blocked(InstallDisabled, "administrative_input_invalid")
	}
	environment, err := Environment(input)
	if err != nil {
		return configuration.blocked(InstallDisabled, err.Error())
	}
	if err := writeJournal(configuration.paths); err != nil {
		return configuration.blocked(InstallDisabled, err.Error())
	}
	if err := writeAtomic(configuration.paths.Environment, environment, 0o640, configuration.deps.ApplyOwnership, configuration.primaryGID()); err != nil {
		return configuration.blocked(InstallDisabled, err.Error())
	}
	manifest, seen, err := installer.ReadState(configuration.paths.Deployment.StateFile)
	if err != nil || !seen {
		return configuration.blocked(InstallDisabled, "deployment_not_ready")
	}
	state := State{SchemaVersion: 1, Profile: ProfileName, ConfigurationSHA256: ProfileSHA256(environment), ApplicationVersion: manifest.Version, SourceCommit: sourceCommit(configuration.paths.BundleRoot), Status: "installed"}
	if err := writeState(configuration.paths, state, configuration.deps.ApplyOwnership, configuration.primaryGID()); err != nil {
		return configuration.blocked(InstallDisabled, err.Error())
	}
	if err := configuration.verifyInstalled(); err != nil {
		return configuration.blocked(InstallDisabled, err.Error())
	}
	_ = os.Remove(configuration.paths.Journal)
	return configuration.success(InstallDisabled, "installed_mock_administrative")
}

func (configuration Configuration) remove() Report {
	if err := configuration.verifyInstalled(); err != nil {
		return configuration.blocked(RemoveDisabled, err.Error())
	}
	if err := os.Remove(configuration.paths.Environment); err != nil {
		return configuration.blocked(RemoveDisabled, "configuration_remove_failed")
	}
	_ = os.Remove(configuration.paths.StateFile)
	_ = os.Remove(configuration.paths.Journal)
	return configuration.success(RemoveDisabled, "removed")
}

func (configuration Configuration) verifyInstalled() error {
	state, seen, err := readState(configuration.paths.StateFile)
	if err != nil || !seen || state.Profile != ProfileName || state.Status != "installed" {
		return fmt.Errorf("configuration_state_invalid")
	}
	data, err := os.ReadFile(configuration.paths.Environment)
	if err != nil || ProfileSHA256(data) != state.ConfigurationSHA256 {
		return fmt.Errorf("configuration_modified")
	}
	if err := validateMetadata(configuration.paths.Environment, 0o640, configuration.primaryGID(), configuration.deps.ApplyOwnership); err != nil {
		return err
	}
	return nil
}

func (configuration Configuration) validateBase() error {
	if err := installer.InspectBundleReadOnly(configuration.paths.BundleRoot); err != nil {
		return fmt.Errorf("bundle_invalid")
	}
	if _, err := os.Stat(configuration.paths.Deployment.Current); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	if _, err := os.Lstat(configuration.paths.Deployment.EnableLink); err == nil {
		return fmt.Errorf("service_enabled")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("service_state_unsafe")
	}
	if _, err := os.Lstat(configuration.paths.Deployment.RuntimeDir); err == nil {
		return fmt.Errorf("service_active")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("service_state_unsafe")
	}
	_, err := configuration.identity()
	if err != nil {
		return err
	}
	identity, _ := configuration.identity()
	if err := installer.VerifyManagedDisabled(configuration.paths.Deployment, identity, configuration.deps.ApplyOwnership); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	return nil
}

func (configuration Configuration) identity() (runtimeidentity.Identity, error) {
	passwd, err := os.ReadFile(configuration.paths.DeploymentIdentityPasswd())
	if err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	group, err := os.ReadFile(configuration.paths.DeploymentIdentityGroup())
	if err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	identity, err := runtimeidentity.ValidateAccountContract(string(passwd), string(group))
	if err != nil {
		return runtimeidentity.Identity{}, fmt.Errorf("identity_not_ready")
	}
	return identity, nil
}

func (paths Paths) DeploymentIdentityPasswd() string {
	return filepath.Join(paths.ConfigDir, "..", "passwd")
}
func (paths Paths) DeploymentIdentityGroup() string {
	return filepath.Join(paths.ConfigDir, "..", "group")
}

func (configuration Configuration) primaryGID() int {
	state, _, _ := identitystate.ReadState(configuration.paths.IdentityState)
	if state == nil {
		return 0
	}
	return state.PrimaryGroup.ID
}
func sourceCommit(root string) string {
	data, err := os.ReadFile(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		return "0000000000000000000000000000000000000000"
	}
	var value struct {
		SourceCommit string `json:"sourceCommit"`
	}
	_ = json.Unmarshal(data, &value)
	return value.SourceCommit
}
func (configuration Configuration) readInput() (Input, error) {
	data, err := os.ReadFile(configuration.paths.Input)
	if err != nil {
		return Input{}, fmt.Errorf("administrative_input_invalid")
	}
	return ValidateInput(data)
}
func (configuration Configuration) blocked(action Action, code string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: "blocked", Profile: ProfileName, Configuration: Check{"configuration", "blocked", code}}
}
func (configuration Configuration) success(action Action, result string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: result, Profile: ProfileName, Configuration: Check{"configuration", "passed", result}}
}
func (report Report) Marshal() ([]byte, error) {
	data, err := json.Marshal(report)
	if err != nil || len(data) > 64*1024 {
		return nil, fmt.Errorf("report_invalid")
	}
	return append(data, '\n'), nil
}

func writeJournal(paths Paths) error {
	if err := os.MkdirAll(paths.StateDirectory, 0o700); err != nil {
		return fmt.Errorf("configuration_journal_write_failed")
	}
	data, _ := json.Marshal(journal{
		SchemaVersion: 1,
		Status:        "in_progress",
		Profile:       ProfileName,
		Steps:         []string{},
	})
	return writeAtomic(paths.Journal, append(data, '\n'), 0o600, false, 0)
}
func writeState(paths Paths, state State, ownership bool, gid int) error {
	data, _ := json.MarshalIndent(state, "", "  ")
	if err := os.MkdirAll(paths.StateDirectory, 0o700); err != nil {
		return fmt.Errorf("configuration_state_write_failed")
	}
	return writeAtomic(paths.StateFile, append(data, '\n'), 0o600, ownership, gid)
}
func writeAtomic(path string, data []byte, mode os.FileMode, ownership bool, gid int) error {
	temporary := path + ".candidate"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, mode)
	if err != nil {
		return fmt.Errorf("configuration_write_failed")
	}
	if _, err = file.Write(data); err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_write_failed")
	}
	if ownership {
		if err := os.Chown(temporary, 0, gid); err != nil {
			_ = os.Remove(temporary)
			return fmt.Errorf("configuration_write_failed")
		}
	}
	if err := os.Chmod(temporary, mode); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_write_failed")
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("configuration_write_failed")
	}
	return nil
}
func readState(path string) (State, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return State{}, false, nil
	}
	if err != nil || len(data) > 16*1024 {
		return State{}, true, fmt.Errorf("configuration_state_invalid")
	}
	var state State
	if decodeStrict(data, &state) != nil || !validState(state) {
		return State{}, true, fmt.Errorf("configuration_state_invalid")
	}
	return state, true, nil
}
func readJournal(path string) (bool, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return false, false, nil
	}
	if err != nil || len(data) > 1024 {
		return true, true, fmt.Errorf("configuration_journal_invalid")
	}
	var value journal
	if decodeStrict(data, &value) != nil || value.SchemaVersion != 1 || value.Status != "in_progress" || value.Profile != ProfileName || len(value.Steps) > 8 {
		return true, true, fmt.Errorf("configuration_journal_invalid")
	}
	return true, true, nil
}
func acquireLock(path string, ownership bool) (*os.File, error) {
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
func releaseLock(file *os.File, path string) { _ = file.Close(); _ = os.Remove(path) }
func validateMetadata(path string, mode os.FileMode, gid int, ownership bool) error {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != mode {
		return fmt.Errorf("configuration_unsafe")
	}
	if ownership {
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 || int(stat.Gid) != gid || stat.Nlink != 1 {
			return fmt.Errorf("configuration_unsafe")
		}
	}
	return nil
}
func hash(data []byte) string { digest := sha256.Sum256(data); return hex.EncodeToString(digest[:]) }

func validState(state State) bool {
	return state.SchemaVersion == 1 && state.Profile == ProfileName &&
		state.Status == "installed" && validHash(state.ConfigurationSHA256) &&
		validVersion(state.ApplicationVersion) && validCommit(state.SourceCommit)
}

func decodeStrict(data []byte, target any) error {
	if err := rejectDuplicateKeys(data); err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return fmt.Errorf("trailing_data")
	}
	return nil
}

func validHash(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value || value == strings.Repeat("0", 64) {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func validCommit(value string) bool {
	if len(value) != 40 || strings.ToLower(value) != value {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}

func validVersion(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("._+-", char)) {
			return false
		}
	}
	return true
}
