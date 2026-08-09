package serverinstallation

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	SchemaVersion  = 1
	MaxOutputBytes = 64 * 1024
)

type Action string

const (
	Inspect Action = "inspect"
	Plan    Action = "plan"
)

func ValidAction(value string) bool { return value == string(Inspect) || value == string(Plan) }

type CommandResult struct {
	Stdout   []byte
	ExitCode int
}

type Runner interface {
	Run(context.Context, string, []string) (CommandResult, error)
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, path string, args []string) (CommandResult, error) {
	command := exec.CommandContext(ctx, path, args...)
	command.Env = []string{"LANG=C", "LC_ALL=C", "PATH=/usr/sbin:/usr/bin:/sbin:/bin"}
	stdout := &boundedBuffer{limit: MaxOutputBytes}
	stderr := &boundedBuffer{limit: MaxOutputBytes}
	command.Stdout = stdout
	command.Stderr = stderr
	err := command.Run()
	if stdout.overflow || stderr.overflow {
		return CommandResult{}, fmt.Errorf("tool_output_oversized")
	}
	if err == nil {
		return CommandResult{Stdout: stdout.data, ExitCode: 0}, nil
	}
	var exitError *exec.ExitError
	if ctx.Err() == nil && errors.As(err, &exitError) && exitError.ExitCode() >= 0 {
		return CommandResult{Stdout: stdout.data, ExitCode: exitError.ExitCode()}, nil
	}
	return CommandResult{}, fmt.Errorf("tool_execution_failed")
}

type Paths struct {
	BundleRoot                         string
	Installer                          string
	HostQualification                  string
	IdentityInstaller                  string
	RuntimeConfiguration               string
	AdministrativeRuntimeConfiguration string
	ServiceLifecycle                   string
}

func SiblingPaths(executable string) Paths {
	root := filepath.Dir(executable)
	return Paths{
		BundleRoot:                         root,
		Installer:                          filepath.Join(root, "atlas-manager-installer"),
		HostQualification:                  filepath.Join(root, "atlas-manager-host-qualification"),
		IdentityInstaller:                  filepath.Join(root, "atlas-manager-runtime-identity-installer"),
		RuntimeConfiguration:               filepath.Join(root, "atlas-manager-runtime-configuration"),
		AdministrativeRuntimeConfiguration: filepath.Join(root, "atlas-manager-administrative-runtime-configuration"),
		ServiceLifecycle:                   filepath.Join(root, "atlas-manager-service-lifecycle"),
	}
}

type Observation struct {
	ID     string `json:"id"`
	Tool   string `json:"tool"`
	Action string `json:"action"`
	Status string `json:"status"`
	Code   string `json:"code"`
}

type Boundary struct {
	Name                 string `json:"name"`
	Tool                 string `json:"tool,omitempty"`
	Action               string `json:"action,omitempty"`
	RequiresRoot         bool   `json:"requiresRoot"`
	RequiresConfirmation bool   `json:"requiresConfirmation"`
	Mutates              bool   `json:"mutates"`
}

type Safety struct {
	PowerManagementBackend        string `json:"powerManagementBackend"`
	MachinePowerEffectsActivation string `json:"machinePowerEffectsActivation"`
	MachinePowerSchedulerEnabled  bool   `json:"machinePowerSchedulerEnabled"`
	MutationExecuted              bool   `json:"mutationExecuted"`
}

type Report struct {
	SchemaVersion     int           `json:"schemaVersion"`
	Action            string        `json:"action"`
	Result            string        `json:"result"`
	InstallationState string        `json:"installationState"`
	Observations      []Observation `json:"observations"`
	NextBoundary      *Boundary     `json:"nextBoundary,omitempty"`
	Safety            Safety        `json:"safety"`
}

func (report Report) Marshal() ([]byte, error) {
	if report.SchemaVersion != SchemaVersion || !ValidAction(report.Action) || !validResult(report.Result) || !validState(report.InstallationState) || len(report.Observations) == 0 || len(report.Observations) > 9 {
		return nil, fmt.Errorf("report_invalid")
	}
	if report.Safety.PowerManagementBackend != "mock" || report.Safety.MachinePowerEffectsActivation != "disabled" || report.Safety.MachinePowerSchedulerEnabled || report.Safety.MutationExecuted {
		return nil, fmt.Errorf("report_invalid")
	}
	if report.Result == "planned" {
		if report.NextBoundary == nil || report.NextBoundary.Name == "" || len(report.NextBoundary.Name) > 96 || !report.NextBoundary.RequiresRoot || !report.NextBoundary.Mutates {
			return nil, fmt.Errorf("report_invalid")
		}
	} else if report.NextBoundary != nil {
		return nil, fmt.Errorf("report_invalid")
	}
	for _, observation := range report.Observations {
		if observation.ID == "" || observation.Tool == "" || observation.Action == "" || !validStatus(observation.Status) || observation.Code == "" || len(observation.Code) > 96 {
			return nil, fmt.Errorf("report_invalid")
		}
	}
	data, err := json.Marshal(report)
	if err != nil || len(data)+1 > MaxOutputBytes {
		return nil, fmt.Errorf("report_oversized")
	}
	return append(data, '\n'), nil
}

type Planner struct {
	paths  Paths
	runner Runner
}

func New(paths Paths, runner Runner) *Planner {
	if runner == nil {
		runner = ExecRunner{}
	}
	return &Planner{paths: paths, runner: runner}
}

type probe struct {
	id, path, tool, action string
	jsonReport             bool
}

func (planner *Planner) Run(ctx context.Context, action Action) Report {
	report := Report{
		SchemaVersion:     SchemaVersion,
		Action:            string(action),
		Result:            "blocked",
		InstallationState: "blocked",
		Observations:      make([]Observation, 0, 9),
		Safety:            Safety{PowerManagementBackend: "mock", MachinePowerEffectsActivation: "disabled", MachinePowerSchedulerEnabled: false, MutationExecuted: false},
	}
	if !ValidAction(string(action)) || !planner.validPaths() {
		report.Observations = append(report.Observations, Observation{ID: "planner", Tool: "atlas-manager-server-installer", Action: string(action), Status: "blocked", Code: "planner_input_invalid"})
		return report
	}
	probes := []probe{
		{"bundle", planner.paths.Installer, "atlas-manager-installer", "inspect-bundle", false},
		{"host_qualify", planner.paths.HostQualification, "atlas-manager-host-qualification", "qualify", true},
		{"host_prepared", planner.paths.HostQualification, "atlas-manager-host-qualification", "verify-prepared", true},
		{"host_disabled", planner.paths.HostQualification, "atlas-manager-host-qualification", "verify-disabled-installation", true},
		{"host_removed", planner.paths.HostQualification, "atlas-manager-host-qualification", "verify-removed", true},
		{"identity", planner.paths.IdentityInstaller, "atlas-manager-runtime-identity-installer", "inspect", true},
		{"runtime_configuration", planner.paths.RuntimeConfiguration, "atlas-manager-runtime-configuration", "inspect", true},
		{"administrative_configuration", planner.paths.AdministrativeRuntimeConfiguration, "atlas-manager-administrative-runtime-configuration", "inspect", true},
		{"lifecycle", planner.paths.ServiceLifecycle, "atlas-manager-service-lifecycle", "inspect", true},
	}
	results := make(map[string]string, len(probes))
	for index, current := range probes {
		observation, result, hardFailure := planner.runProbe(ctx, current)
		report.Observations = append(report.Observations, observation)
		if result != "" {
			results[current.id] = result
		}
		if hardFailure {
			for _, skipped := range probes[index+1:] {
				report.Observations = append(report.Observations, Observation{ID: skipped.id, Tool: skipped.tool, Action: skipped.action, Status: "skipped", Code: "cascade_skipped"})
			}
			return report
		}
	}
	report.InstallationState = classify(results)
	if report.InstallationState == "blocked" {
		return report
	}
	if action == Plan {
		report.NextBoundary = nextBoundary(report.InstallationState)
		report.Result = "planned"
	} else {
		report.Result = "inspected"
	}
	return report
}

func (planner *Planner) runProbe(ctx context.Context, current probe) (Observation, string, bool) {
	observation := Observation{ID: current.id, Tool: current.tool, Action: current.action, Status: "blocked", Code: "tool_failed"}
	result, err := planner.runner.Run(ctx, current.path, []string{current.action})
	if err != nil {
		observation.Code = err.Error()
		return observation, "", true
	}
	if result.ExitCode != 0 && result.ExitCode != 1 {
		observation.Code = "tool_exit_invalid"
		return observation, "", true
	}
	if !current.jsonReport {
		if result.ExitCode != 0 || len(bytes.TrimSpace(result.Stdout)) != 0 {
			observation.Code = "bundle_inspection_failed"
			return observation, "", true
		}
		observation.Status, observation.Code = "passed", "bundle_valid"
		return observation, "bundle_valid", false
	}
	parsed, err := decodeToolReport(result.Stdout, current.action)
	if err != nil {
		observation.Code = err.Error()
		return observation, "", true
	}
	if !allowedToolResult(current.id, parsed.Result) {
		observation.Code = "tool_report_result_invalid"
		return observation, "", true
	}
	blockedResult := parsed.Result == "blocked" || parsed.Result == "interrupted"
	if blockedResult != (result.ExitCode == 1) {
		observation.Code = "tool_exit_report_mismatch"
		return observation, "", true
	}
	observation.Code = parsed.Result
	if blockedResult {
		observation.Status = "blocked"
	} else {
		observation.Status = "passed"
	}
	return observation, parsed.Result, false
}

func allowedToolResult(id, result string) bool {
	allowed := map[string]map[string]bool{
		"host_qualify":                 {"qualified": true, "preparation_required": true, "prepared": true, "blocked": true},
		"host_prepared":                {"prepared": true, "blocked": true},
		"host_disabled":                {"disabled_installation_verified": true, "blocked": true},
		"host_removed":                 {"removed": true, "blocked": true},
		"identity":                     {"absent": true, "prepared": true, "managed_prepared": true, "exact_unmanaged": true, "blocked": true, "interrupted": true},
		"runtime_configuration":        {"absent": true, "installed_mock": true, "blocked": true, "interrupted": true},
		"administrative_configuration": {"absent": true, "installed": true, "blocked": true, "interrupted": true},
		"lifecycle":                    {"ready_for_activation": true, "active_mock_verified": true, "blocked": true},
	}
	return allowed[id][result]
}

type toolReport struct {
	SchemaVersion int    `json:"schemaVersion"`
	Action        string `json:"action"`
	Result        string `json:"result"`
}

func decodeToolReport(data []byte, expectedAction string) (toolReport, error) {
	if len(data) == 0 {
		return toolReport{}, fmt.Errorf("tool_report_missing")
	}
	if len(data) > MaxOutputBytes {
		return toolReport{}, fmt.Errorf("tool_report_oversized")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	var report toolReport
	if decoder.Decode(&report) != nil || report.SchemaVersion != SchemaVersion || report.Action != expectedAction || report.Result == "" || len(report.Result) > 96 {
		return toolReport{}, fmt.Errorf("tool_report_invalid")
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return toolReport{}, fmt.Errorf("tool_report_invalid")
	}
	return report, nil
}

func classify(results map[string]string) string {
	if results["bundle"] != "bundle_valid" {
		return "blocked"
	}
	for _, result := range results {
		if result == "interrupted" || result == "exact_unmanaged" {
			return "blocked"
		}
	}
	if results["lifecycle"] == "active_mock_verified" {
		return "active_mock"
	}
	if results["host_disabled"] == "disabled_installation_verified" {
		return "disabled_installation"
	}
	if results["host_qualify"] == "preparation_required" {
		return "preparation_required"
	}
	if results["host_qualify"] == "qualified" || results["host_qualify"] == "prepared" || results["host_prepared"] == "prepared" {
		return "disabled_installation_ready"
	}
	if results["host_removed"] == "removed" {
		return "removed"
	}
	return "blocked"
}

func nextBoundary(state string) *Boundary {
	switch state {
	case "preparation_required":
		return &Boundary{Name: "prepare_runtime_identity", Tool: "atlas-manager-runtime-identity-installer", Action: "prepare-disabled", RequiresRoot: true, RequiresConfirmation: true, Mutates: true}
	case "disabled_installation_ready", "removed":
		return &Boundary{Name: "install_disabled_application", Tool: "atlas-manager-installer", Action: "install-disabled", RequiresRoot: true, RequiresConfirmation: false, Mutates: true}
	case "disabled_installation":
		return &Boundary{Name: "select_runtime_configuration_profile", RequiresRoot: true, RequiresConfirmation: true, Mutates: true}
	case "active_mock":
		return &Boundary{Name: "deactivate_service_before_deployment_mutation", Tool: "atlas-manager-service-lifecycle", Action: "deactivate", RequiresRoot: true, RequiresConfirmation: true, Mutates: true}
	default:
		return nil
	}
}

func (planner *Planner) validPaths() bool {
	values := []string{planner.paths.BundleRoot, planner.paths.Installer, planner.paths.HostQualification, planner.paths.IdentityInstaller, planner.paths.RuntimeConfiguration, planner.paths.AdministrativeRuntimeConfiguration, planner.paths.ServiceLifecycle}
	for _, value := range values {
		if value == "" || !filepath.IsAbs(value) || filepath.Clean(value) != value {
			return false
		}
	}
	return true
}

func validResult(value string) bool {
	return value == "inspected" || value == "planned" || value == "blocked"
}
func validState(value string) bool {
	return value == "preparation_required" || value == "disabled_installation_ready" || value == "disabled_installation" || value == "active_mock" || value == "removed" || value == "blocked"
}
func validStatus(value string) bool {
	return value == "passed" || value == "blocked" || value == "skipped"
}

type boundedBuffer struct {
	data     []byte
	limit    int
	overflow bool
}

func (buffer *boundedBuffer) Write(value []byte) (int, error) {
	if len(buffer.data)+len(value) > buffer.limit {
		remaining := buffer.limit - len(buffer.data)
		if remaining > 0 {
			buffer.data = append(buffer.data, value[:remaining]...)
		}
		buffer.overflow = true
		return len(value), nil
	}
	buffer.data = append(buffer.data, value...)
	return len(value), nil
}

func ExecutablePath() (string, error) {
	value, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("executable_invalid")
	}
	return filepath.Clean(value), nil
}
