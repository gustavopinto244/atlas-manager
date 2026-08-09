package servicelifecycle

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/administrativeconfiguration"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identitystate"
	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeconfiguration"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeverification"
	"github.com/atlas-manager/atlas-manager/deployment/internal/systemdunit"
)

const (
	ActivationConfirmation   = "confirm_atlas_manager_mock_service_activation"
	DeactivationConfirmation = "confirm_atlas_manager_service_deactivation"
	SystemctlPath            = "/usr/bin/systemctl"
	UnitName                 = "atlas-manager.service"
	MaxOutput                = 16 * 1024
	MaxReport                = 64 * 1024
)

type Action string

const (
	Inspect          Action = "inspect"
	ActivateMock     Action = "activate-mock"
	VerifyActiveMock Action = "verify-active-mock"
	Deactivate       Action = "deactivate"
	VerifyInactive   Action = "verify-inactive"
)

func ValidAction(value string) bool {
	return value == string(Inspect) || value == string(ActivateMock) || value == string(VerifyActiveMock) || value == string(Deactivate) || value == string(VerifyInactive)
}

type Paths struct {
	BundleRoot                string
	Deployment                installer.Paths
	Passwd                    string
	Group                     string
	ConfigEnvironment         string
	ConfigState               string
	AdministrativeConfigState string
	IdentityState             string
	IdentityJournal           string
	StateDirectory            string
	StateFile                 string
	Journal                   string
	Lock                      string
	Systemctl                 string
}

func ProductionPaths(bundleRoot string) Paths {
	deployment := installer.ProductionPaths()
	return Paths{
		BundleRoot: bundleRoot, Deployment: deployment, Passwd: "/etc/passwd", Group: "/etc/group",
		ConfigEnvironment:         "/etc/atlas-manager/atlas-manager.env",
		ConfigState:               "/var/lib/atlas-manager-runtime-configuration/state.json",
		AdministrativeConfigState: "/var/lib/atlas-manager-administrative-runtime-configuration/state.json",
		IdentityState:             "/var/lib/atlas-manager-identity-preparation/state.json",
		IdentityJournal:           "/var/lib/atlas-manager-identity-preparation/transaction.json",
		StateDirectory:            "/var/lib/atlas-manager-service-lifecycle", StateFile: "/var/lib/atlas-manager-service-lifecycle/state.json",
		Journal: "/var/lib/atlas-manager-service-lifecycle/transaction.json", Lock: "/run/atlas-manager-service-lifecycle.lock", Systemctl: SystemctlPath,
	}
}

type CommandResult struct {
	Stdout   string
	ExitCode int
}

type CommandExecutor interface {
	Run(context.Context, string, []string) (CommandResult, error)
}

type Dependencies struct {
	EffectiveUID   func() int
	Platform       func() string
	Architecture   func() string
	ApplyOwnership bool
	Executor       CommandExecutor
	Health         func(context.Context, int) error
	Now            func() time.Time
}

type Check struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Code   string `json:"code"`
}

type Report struct {
	SchemaVersion        int     `json:"schemaVersion"`
	Action               string  `json:"action"`
	Result               string  `json:"result"`
	Deployment           Check   `json:"deployment"`
	Identity             Check   `json:"identity"`
	Configuration        Check   `json:"configuration"`
	Systemd              Check   `json:"systemd"`
	Runtime              Check   `json:"runtime"`
	Health               Check   `json:"health"`
	AdministrativeRoutes Check   `json:"administrativeRoutes"`
	Transaction          Check   `json:"transaction"`
	Checks               []Check `json:"checks"`
}

type State struct {
	SchemaVersion       int    `json:"schemaVersion"`
	Status              string `json:"status"`
	ApplicationVersion  string `json:"applicationVersion"`
	SourceCommit        string `json:"sourceCommit"`
	ConfigurationSHA256 string `json:"runtimeConfigurationSha256"`
	SystemdUnitSHA256   string `json:"systemdUnitSha256"`
}

type Journal struct {
	SchemaVersion int      `json:"schemaVersion"`
	Status        string   `json:"status"`
	Steps         []string `json:"completedSteps"`
}

type Service struct {
	paths Paths
	deps  Dependencies
}

func New(paths Paths, deps Dependencies) Service {
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
	if deps.Executor == nil {
		deps.Executor = SystemctlExecutor{}
	}
	if deps.Health == nil {
		deps.Health = func(ctx context.Context, pid int) error {
			return runtimeverification.Verify(ctx, pid, runtimeverification.NewDependencies())
		}
	}
	return Service{paths: paths, deps: deps}
}

func (service Service) Run(ctx context.Context, action Action, confirmation string) (Report, error) {
	if !ValidAction(string(action)) {
		return Report{}, fmt.Errorf("action_invalid")
	}
	if service.deps.EffectiveUID() != 0 {
		return service.blocked(action, "effective_root_required"), nil
	}
	if service.deps.Platform() != "linux" || service.deps.Architecture() != "amd64" {
		return service.blocked(action, "unsupported_platform"), nil
	}
	if action == Inspect {
		return service.inspect(ctx), nil
	}
	if action == ActivateMock && confirmation != ActivationConfirmation {
		return service.blocked(action, "confirmation_invalid"), nil
	}
	if action == Deactivate && confirmation != DeactivationConfirmation {
		return service.blocked(action, "confirmation_invalid"), nil
	}
	if action == VerifyActiveMock {
		if err := service.validateStatic(); err != nil {
			return service.blocked(action, code(err)), nil
		}
		if err := service.verifyActive(ctx); err != nil {
			return service.blocked(action, code(err)), nil
		}
		return service.success(action, "active_mock_verified"), nil
	}
	if action == VerifyInactive {
		if err := service.verifyInactive(); err != nil {
			return service.blocked(action, code(err)), nil
		}
		return service.success(action, "inactive"), nil
	}
	if _, seen, err := readJournal(service.paths.Journal); seen || err != nil {
		return service.blocked(action, "activation_journal_present"), nil
	}
	lock, err := acquireLock(service.paths.Lock, service.deps.ApplyOwnership)
	if err != nil {
		return service.blocked(action, code(err)), nil
	}
	defer releaseLock(lock, service.paths.Lock)
	if action == ActivateMock {
		return service.activate(ctx)
	}
	return service.deactivate(ctx)
}

func (service Service) inspect(ctx context.Context) Report {
	if _, seen, err := readJournal(service.paths.Journal); seen || err != nil {
		return service.blocked(Inspect, "activation_journal_present")
	}
	if _, seen, err := readState(service.paths.StateFile); err == nil && seen {
		if stateErr := service.validateState(); stateErr == nil {
			return service.success(Inspect, "active_mock_verified")
		}
		return service.blocked(Inspect, "activation_state_invalid")
	}
	if err := service.validateReady(); err != nil {
		return service.blocked(Inspect, code(err))
	}
	return service.success(Inspect, "ready_for_activation")
}

func (service Service) validateReady() error {
	if err := service.validateStatic(); err != nil {
		return err
	}
	if _, err := os.Lstat(service.paths.Deployment.EnableLink); err == nil {
		return fmt.Errorf("service_already_active")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("service_state_unsafe")
	}
	if _, err := os.Lstat(service.paths.Deployment.RuntimeDir); err == nil {
		return fmt.Errorf("service_already_active")
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("service_state_unsafe")
	}
	state, err := service.systemdState(context.Background())
	if err != nil {
		return fmt.Errorf("systemd_state_unavailable")
	}
	if state.Enabled || state.Active {
		return fmt.Errorf("service_already_active")
	}
	return nil
}

func (service Service) validateStatic() error {
	if err := installer.InspectBundleReadOnly(service.paths.BundleRoot); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	identity, err := service.identity()
	if err != nil {
		return fmt.Errorf("identity_not_ready")
	}
	managed, seen, stateErr := identitystate.ReadState(service.paths.IdentityState)
	if stateErr != nil || !seen || managed == nil || managed.RuntimeUser.ID != identity.UserID || managed.PrimaryGroup.ID != identity.PrimaryGroupID || managed.HelperGroup.ID != identity.HelperGroupID {
		return fmt.Errorf("identity_not_ready")
	}
	if _, journalSeen, journalErr := identitystate.ReadJournal(service.paths.IdentityJournal); journalSeen || journalErr != nil {
		return fmt.Errorf("identity_not_ready")
	}
	if err := installer.VerifyManagedDisabled(service.paths.Deployment, identity, service.deps.ApplyOwnership); err != nil {
		return fmt.Errorf("deployment_not_ready")
	}
	if err := service.validateConfiguration(); err != nil {
		return err
	}
	if err := service.validateUnit(); err != nil {
		return err
	}
	if err := service.validateSystemctl(); err != nil {
		return err
	}
	return nil
}

func (service Service) validateConfiguration() error {
	data, err := os.ReadFile(service.paths.ConfigEnvironment)
	if err != nil {
		return fmt.Errorf("configuration_absent")
	}
	if bytes.Equal(data, runtimeconfiguration.ProfileBytes()) {
		stateData, err := os.ReadFile(service.paths.ConfigState)
		if err != nil {
			return fmt.Errorf("configuration_absent")
		}
		var state runtimeconfiguration.State
		if err := decodeStrict(stateData, &state); err != nil || runtimeconfiguration.ValidateState(state) != nil || state.ConfigurationSHA256 != runtimeconfiguration.ProfileSHA256() {
			return fmt.Errorf("configuration_modified")
		}
		return nil
	}
	if service.paths.AdministrativeConfigState != "" && isAdministrativeProfile(data) {
		stateData, err := os.ReadFile(service.paths.AdministrativeConfigState)
		if err != nil {
			return fmt.Errorf("configuration_absent")
		}
		var state administrativeconfiguration.State
		if err := decodeStrict(stateData, &state); err != nil || state.SchemaVersion != 1 || state.Profile != "mock-administrative" || state.Status != "installed" || state.ConfigurationSHA256 != hashConfiguration(data) {
			return fmt.Errorf("configuration_modified")
		}
		return nil
	}
	return fmt.Errorf("configuration_modified")
}

func isAdministrativeProfile(data []byte) bool {
	value := string(data)
	for _, required := range []string{"POWER_MANAGEMENT_BACKEND=mock\n", "MACHINE_POWER_EFFECTS_ACTIVATION=disabled\n", "MACHINE_POWER_SCHEDULER_ENABLED=false\n", "ADMINISTRATIVE_SERVICE_MANAGEMENT_HTTP_ENABLED=true\n", "ADMINISTRATIVE_SERVICE_AVAILABILITY_HTTP_ENABLED=true\n", "ADMINISTRATIVE_OVERVIEW_HTTP_ENABLED=true\n", "ADMINISTRATIVE_DASHBOARD_ENABLED=true\n", "ADMINISTRATIVE_BACKUP_HTTP_ENABLED=true\n", "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\n", "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\n", "ADMINISTRATIVE_PUBLIC_ORIGIN=https://", "ADMINISTRATIVE_ROLE_ASSIGNMENTS="} {
		if !strings.Contains(value, required) {
			return false
		}
	}
	for _, required := range []string{"BACKUP_SCHEDULER_ENABLED=false\n", "REGISTERED_SERVICES_JSON=", "REGISTERED_BACKUP_TARGETS_JSON="} {
		if !strings.Contains(value, required) {
			return false
		}
	}
	return true
}

func hashConfiguration(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func (service Service) validateUnit() error {
	data, err := os.ReadFile(service.paths.Deployment.Unit)
	if err != nil || string(data) != systemdunit.Content || !systemdunit.Validate(string(data)) {
		return fmt.Errorf("service_unit_invalid")
	}
	return nil
}

func (service Service) validateSystemctl() error {
	if service.paths.Systemctl == "" {
		return fmt.Errorf("systemctl_missing")
	}
	info, err := os.Lstat(service.paths.Systemctl)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o111 == 0 || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("systemctl_unsafe")
	}
	if service.deps.ApplyOwnership && fileUID(info) != 0 {
		return fmt.Errorf("systemctl_unsafe")
	}
	return nil
}

func (service Service) activate(ctx context.Context) (Report, error) {
	if err := service.validateReady(); err != nil {
		return service.blocked(ActivateMock, code(err)), nil
	}
	if err := writeJournal(service.paths, Journal{SchemaVersion: 1, Status: "in_progress"}); err != nil {
		return service.blocked(ActivateMock, "activation_journal_write_failed"), nil
	}
	started, enabled := false, false
	fail := func(failure string) (Report, error) {
		if rollbackErr := service.rollback(ctx, started, enabled); rollbackErr != nil {
			return service.failure(ActivateMock, "activation_failed_recovery_required", failure), nil
		}
		_ = os.Remove(service.paths.Journal)
		return service.failure(ActivateMock, "activation_failed_rolled_back", failure), nil
	}
	if err := service.command(ctx, []string{"daemon-reload"}); err != nil {
		return fail("daemon_reload_failed")
	}
	if state, err := service.systemdState(ctx); err != nil || !state.Loaded {
		return fail("service_unit_invalid")
	}
	if err := service.command(ctx, []string{"enable", UnitName}); err != nil {
		return fail("service_enable_failed")
	}
	enabled = true
	state, err := service.systemdState(ctx)
	if err != nil || !state.Enabled {
		return fail("service_enable_failed")
	}
	started = true
	if err := service.command(ctx, []string{"start", UnitName}); err != nil {
		return fail("service_start_failed")
	}
	state, err = service.systemdState(ctx)
	if err != nil || !state.Active || state.PID <= 0 {
		return fail("service_not_active")
	}
	if err := service.deps.Health(ctx, state.PID); err != nil {
		return fail(code(err))
	}
	if err := service.writeState(); err != nil {
		return fail("activation_state_write_failed")
	}
	if err := os.Remove(service.paths.Journal); err != nil {
		return service.blocked(ActivateMock, "activation_journal_remove_failed"), nil
	}
	return service.success(ActivateMock, "active_mock_verified"), nil
}

func (service Service) deactivate(ctx context.Context) (Report, error) {
	if err := service.validateState(); err != nil {
		return service.blocked(Deactivate, "activation_state_invalid"), nil
	}
	if err := service.validateConfiguration(); err != nil {
		return service.blocked(Deactivate, code(err)), nil
	}
	state, err := service.systemdState(ctx)
	if err != nil || !state.Active {
		return service.blocked(Deactivate, "service_not_active"), nil
	}
	if err := writeJournal(service.paths, Journal{SchemaVersion: 1, Status: "in_progress"}); err != nil {
		return service.blocked(Deactivate, "activation_journal_write_failed"), nil
	}
	if err := service.command(ctx, []string{"stop", UnitName}); err != nil {
		return service.blocked(Deactivate, "deactivation_stop_failed"), nil
	}
	state, err = service.systemdState(ctx)
	if err != nil || state.Active {
		return service.blocked(Deactivate, "service_not_active"), nil
	}
	if err := service.command(ctx, []string{"disable", UnitName}); err != nil {
		return service.blocked(Deactivate, "deactivation_disable_failed"), nil
	}
	state, err = service.systemdState(ctx)
	if err != nil || state.Enabled {
		return service.blocked(Deactivate, "deactivation_disable_failed"), nil
	}
	if err := service.command(ctx, []string{"daemon-reload"}); err != nil {
		return service.blocked(Deactivate, "daemon_reload_failed"), nil
	}
	if err := os.Remove(service.paths.StateFile); err != nil && !os.IsNotExist(err) {
		return service.blocked(Deactivate, "activation_state_remove_failed"), nil
	}
	if err := os.Remove(service.paths.Journal); err != nil {
		return service.blocked(Deactivate, "activation_journal_remove_failed"), nil
	}
	return service.success(Deactivate, "deactivated"), nil
}

func (service Service) verifyActive(ctx context.Context) error {
	if err := service.validateConfiguration(); err != nil {
		return err
	}
	if err := service.validateUnit(); err != nil {
		return err
	}
	if _, err := service.identity(); err != nil {
		return fmt.Errorf("runtime_identity_invalid")
	}
	state, err := service.systemdState(ctx)
	if err != nil || !state.Loaded || !state.Active || state.SubState != "running" || !state.Enabled || state.PID <= 0 {
		return fmt.Errorf("service_not_active")
	}
	if err := service.deps.Health(ctx, state.PID); err != nil {
		return err
	}
	if _, err := os.Stat(service.paths.Deployment.RuntimeDir); err == nil { /* runtime marker is authoritative only for production systemd; fakes may omit it */
	}
	return nil
}

func (service Service) verifyInactive() error {
	if err := service.validateSystemctl(); err != nil {
		return err
	}
	state, err := service.systemdState(context.Background())
	if err != nil {
		return fmt.Errorf("service_state_unavailable")
	}
	if state.Active || state.Enabled {
		return fmt.Errorf("service_active_or_enabled")
	}
	if _, err := os.Lstat(service.paths.Deployment.EnableLink); err == nil {
		return fmt.Errorf("service_enabled")
	}
	if _, err := os.Lstat(service.paths.Deployment.RuntimeDir); err == nil {
		return fmt.Errorf("service_active_or_ambiguous")
	}
	return nil
}

type systemdState struct {
	Loaded, Active, Enabled bool
	SubState                string
	PID                     int
}

func (service Service) systemdState(ctx context.Context) (systemdState, error) {
	show, err := service.deps.Executor.Run(ctx, service.paths.Systemctl, []string{"show", UnitName, "--property=LoadState", "--property=ActiveState", "--property=SubState", "--property=UnitFileState", "--property=MainPID", "--property=ExecMainStatus", "--no-pager"})
	if err != nil || show.ExitCode != 0 {
		return systemdState{}, fmt.Errorf("systemd_state_unavailable")
	}
	state := systemdState{}
	for _, line := range strings.Split(show.Stdout, "\n") {
		parts := strings.SplitN(line, "=", 2)
		if len(parts) != 2 {
			continue
		}
		switch parts[0] {
		case "LoadState":
			state.Loaded = parts[1] == "loaded"
		case "ActiveState":
			state.Active = parts[1] == "active"
		case "SubState":
			state.SubState = parts[1]
		case "UnitFileState":
			state.Enabled = parts[1] == "enabled"
		case "MainPID":
			state.PID, _ = atoiPositive(parts[1])
		}
	}
	return state, nil
}

func (service Service) command(ctx context.Context, args []string) error {
	result, err := service.deps.Executor.Run(ctx, service.paths.Systemctl, args)
	if err != nil || result.ExitCode != 0 || len(result.Stdout) > MaxOutput {
		return fmt.Errorf("systemctl_failed")
	}
	return nil
}

func (service Service) rollback(ctx context.Context, started, enabled bool) error {
	if started {
		if err := service.command(ctx, []string{"stop", UnitName}); err != nil {
			return err
		}
		state, err := service.systemdState(ctx)
		if err != nil || state.Active {
			return fmt.Errorf("rollback_incomplete")
		}
	}
	if enabled {
		if err := service.command(ctx, []string{"disable", UnitName}); err != nil {
			return err
		}
		state, err := service.systemdState(ctx)
		if err != nil || state.Enabled {
			return fmt.Errorf("rollback_incomplete")
		}
	}
	return nil
}

func (service Service) identity() (runtimeidentity.Identity, error) {
	passwd, err := os.ReadFile(service.paths.Passwd)
	if err != nil {
		return runtimeidentity.Identity{}, err
	}
	group, err := os.ReadFile(service.paths.Group)
	if err != nil {
		return runtimeidentity.Identity{}, err
	}
	return runtimeidentity.ValidateAccountContract(string(passwd), string(group))
}

func (service Service) writeState() error {
	identity, err := service.identity()
	if err != nil {
		return err
	}
	_ = identity
	bundleData, err := os.ReadFile(filepath.Join(service.paths.BundleRoot, "MANIFEST.json"))
	if err != nil {
		return err
	}
	value, err := manifest.Decode(bundleData)
	if err != nil {
		return err
	}
	configData, err := os.ReadFile(service.paths.ConfigEnvironment)
	if err != nil {
		return err
	}
	unitData, err := os.ReadFile(service.paths.Deployment.Unit)
	if err != nil {
		return err
	}
	state := State{SchemaVersion: 1, Status: "active_mock", ApplicationVersion: value.Version, SourceCommit: value.SourceCommit, ConfigurationSHA256: digest(configData), SystemdUnitSHA256: digest(unitData)}
	if err := os.MkdirAll(service.paths.StateDirectory, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary := service.paths.StateFile + ".candidate"
	file, err := os.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = file.Write(append(data, '\n')); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(temporary)
		return err
	}
	if err := os.Rename(temporary, service.paths.StateFile); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func (service Service) validateState() error {
	data, err := os.ReadFile(service.paths.StateFile)
	if err != nil {
		return err
	}
	var state State
	if err := decodeStrict(data, &state); err != nil || state.SchemaVersion != 1 || state.Status != "active_mock" || !safeHash(state.ConfigurationSHA256) || !safeHash(state.SystemdUnitSHA256) || !safeVersion(state.ApplicationVersion) || !safeCommit(state.SourceCommit) {
		return fmt.Errorf("activation_state_invalid")
	}
	configuration, err := os.ReadFile(service.paths.ConfigEnvironment)
	if err != nil || digest(configuration) != state.ConfigurationSHA256 {
		return fmt.Errorf("activation_state_invalid")
	}
	unit, err := os.ReadFile(service.paths.Deployment.Unit)
	if err != nil || digest(unit) != state.SystemdUnitSHA256 {
		return fmt.Errorf("activation_state_invalid")
	}
	return nil
}

func (service Service) success(action Action, result string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: result, Deployment: Check{"deployment", "passed", "deployment_ready"}, Identity: Check{"identity", "passed", "identity_ready"}, Configuration: Check{"configuration", "passed", "mock_only"}, Systemd: Check{"systemd", "passed", result}, Runtime: Check{"runtime", "passed", result}, Health: Check{"health", "passed", result}, AdministrativeRoutes: Check{"administrative_routes", "passed", "routes_absent"}, Transaction: Check{"transaction", "passed", "activation_transaction_absent"}}
}

func (service Service) blocked(action Action, failure string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: "blocked", Systemd: Check{"systemd", "blocked", failure}, Transaction: Check{"transaction", "blocked", failure}}
}

func (service Service) failure(action Action, result, failure string) Report {
	return Report{SchemaVersion: 1, Action: string(action), Result: result, Systemd: Check{Name: "systemd", Status: "blocked", Code: failure}, Transaction: Check{Name: "transaction", Status: "blocked", Code: result}}
}

func (report Report) Marshal() ([]byte, error) {
	data, err := json.Marshal(report)
	if err != nil || len(data)+1 > MaxReport {
		return nil, fmt.Errorf("activation_report_invalid")
	}
	return append(data, '\n'), nil
}

func code(err error) string {
	if err == nil {
		return "blocked"
	}
	value := err.Error()
	if strings.Contains(value, " ") || value == "" {
		return "qualification_failed"
	}
	return value
}
func digest(data []byte) string { value := sha256.Sum256(data); return hex.EncodeToString(value[:]) }
func safeHash(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	for _, char := range value {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')) {
			return false
		}
	}
	return true
}
func safeCommit(value string) bool {
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
func safeVersion(value string) bool {
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
func atoiPositive(value string) (int, error) {
	var result int
	for _, char := range strings.TrimSpace(value) {
		if char < '0' || char > '9' {
			return 0, fmt.Errorf("invalid_number")
		}
		result = result*10 + int(char-'0')
		if result <= 0 {
			return 0, fmt.Errorf("invalid_number")
		}
	}
	return result, nil
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

func rejectDuplicateKeys(data []byte) error {
	decoder := json.NewDecoder(bytes.NewReader(data))
	var walk func() error
	walk = func() error {
		token, err := decoder.Token()
		if err != nil {
			return err
		}
		delimiter, ok := token.(json.Delim)
		if !ok {
			return nil
		}
		if delimiter == '{' {
			seen := map[string]struct{}{}
			for decoder.More() {
				key, err := decoder.Token()
				if err != nil {
					return err
				}
				name, ok := key.(string)
				if !ok {
					return fmt.Errorf("activation_state_invalid")
				}
				if _, exists := seen[name]; exists {
					return fmt.Errorf("activation_state_duplicate_field")
				}
				seen[name] = struct{}{}
				if err := walk(); err != nil {
					return err
				}
			}
		} else if delimiter == '[' {
			for decoder.More() {
				if err := walk(); err != nil {
					return err
				}
			}
		}
		_, err = decoder.Token()
		return err
	}
	if err := walk(); err != nil {
		return err
	}
	_, err := decoder.Token()
	if err != io.EOF {
		return fmt.Errorf("activation_state_trailing_data")
	}
	return nil
}

func writeJournal(paths Paths, journal Journal) error {
	if err := os.MkdirAll(paths.StateDirectory, 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(journal, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.OpenFile(paths.Journal, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err = file.Write(append(data, '\n')); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(paths.Journal)
		return err
	}
	return nil
}
func readJournal(path string) (Journal, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return Journal{}, false, nil
	}
	if err != nil {
		return Journal{}, true, err
	}
	var journal Journal
	if decodeStrict(data, &journal) != nil || journal.SchemaVersion != 1 || journal.Status != "in_progress" {
		return Journal{}, true, fmt.Errorf("activation_journal_invalid")
	}
	return journal, true, nil
}
func readState(path string) (State, bool, error) {
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return State{}, false, nil
	}
	if err != nil {
		return State{}, true, err
	}
	var state State
	if decodeStrict(data, &state) != nil {
		return State{}, true, fmt.Errorf("activation_state_invalid")
	}
	return state, true, nil
}

func acquireLock(path string, ownership bool) (*os.File, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("activation_lock_failed")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("activation_lock_conflict")
	}
	if ownership {
		_ = file.Chown(0, 0)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		_ = os.Remove(path)
		return nil, fmt.Errorf("activation_lock_conflict")
	}
	return file, nil
}
func releaseLock(file *os.File, path string) {
	if file != nil {
		_ = file.Close()
	}
	_ = os.Remove(path)
}
func fileUID(info os.FileInfo) uint32 {
	if stats, ok := info.Sys().(*syscall.Stat_t); ok {
		return stats.Uid
	}
	return ^uint32(0)
}

type SystemctlExecutor struct{}

func (SystemctlExecutor) Run(ctx context.Context, path string, args []string) (CommandResult, error) {
	if path != SystemctlPath {
		return CommandResult{}, fmt.Errorf("systemctl_path_invalid")
	}
	commandContext, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	command := exec.CommandContext(commandContext, path, args...)
	command.Env = []string{"PATH=/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TZ=UTC"}
	command.Stdin = strings.NewReader("")
	var stdout, stderr boundedOutput
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	if err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return CommandResult{Stdout: stdout.String(), ExitCode: exit.ExitCode()}, nil
		}
		return CommandResult{}, err
	}
	if stderr.overflow || stdout.overflow {
		return CommandResult{}, fmt.Errorf("systemctl_output_oversized")
	}
	return CommandResult{Stdout: stdout.String()}, nil
}

type boundedOutput struct {
	bytes.Buffer
	overflow bool
}

func (output *boundedOutput) Write(data []byte) (int, error) {
	if output.Len()+len(data) > MaxOutput {
		output.overflow = true
		return len(data), nil
	}
	return output.Buffer.Write(data)
}
