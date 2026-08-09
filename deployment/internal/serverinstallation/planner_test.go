package serverinstallation

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

type fakeRunner struct {
	results map[string]CommandResult
	errors  map[string]error
	calls   []string
}

func (runner *fakeRunner) Run(_ context.Context, path string, args []string) (CommandResult, error) {
	key := filepath.Base(path) + " " + args[0]
	runner.calls = append(runner.calls, key)
	if err := runner.errors[key]; err != nil {
		return CommandResult{}, err
	}
	result, ok := runner.results[key]
	if !ok {
		return blockedReport(args[0]), nil
	}
	return result, nil
}

func reportResult(action, result string, exitCode int) CommandResult {
	data, _ := json.Marshal(map[string]any{"schemaVersion": 1, "action": action, "result": result, "additionalContract": map[string]string{"status": "preserved"}})
	return CommandResult{Stdout: append(data, '\n'), ExitCode: exitCode}
}

func blockedReport(action string) CommandResult { return reportResult(action, "blocked", 1) }

func testPaths(t *testing.T) Paths {
	t.Helper()
	return SiblingPaths(filepath.Join(t.TempDir(), "atlas-manager-server-installer"))
}

func baseResults() map[string]CommandResult {
	return map[string]CommandResult{
		"atlas-manager-installer inspect-bundle":                        {ExitCode: 0},
		"atlas-manager-host-qualification qualify":                      blockedReport("qualify"),
		"atlas-manager-host-qualification verify-prepared":              blockedReport("verify-prepared"),
		"atlas-manager-host-qualification verify-disabled-installation": blockedReport("verify-disabled-installation"),
		"atlas-manager-host-qualification verify-removed":               blockedReport("verify-removed"),
		"atlas-manager-runtime-identity-installer inspect":              reportResult("inspect", "blocked", 1),
		"atlas-manager-runtime-configuration inspect":                   reportResult("inspect", "blocked", 1),
		"atlas-manager-administrative-runtime-configuration inspect":    reportResult("inspect", "blocked", 1),
		"atlas-manager-service-lifecycle inspect":                       reportResult("inspect", "blocked", 1),
	}
}

func TestPlanClassifiesInstallationStatesWithoutMutating(t *testing.T) {
	tests := []struct {
		name      string
		configure func(map[string]CommandResult)
		state     string
		boundary  string
	}{
		{"absent identity", func(values map[string]CommandResult) {
			values["atlas-manager-host-qualification qualify"] = reportResult("qualify", "preparation_required", 0)
		}, "preparation_required", "prepare_runtime_identity"},
		{"prepared host", func(values map[string]CommandResult) {
			values["atlas-manager-host-qualification qualify"] = reportResult("qualify", "prepared", 0)
			values["atlas-manager-host-qualification verify-prepared"] = reportResult("verify-prepared", "prepared", 0)
		}, "disabled_installation_ready", "install_disabled_application"},
		{"same version disabled", func(values map[string]CommandResult) {
			values["atlas-manager-host-qualification verify-disabled-installation"] = reportResult("verify-disabled-installation", "disabled_installation_verified", 0)
		}, "disabled_installation", "select_runtime_configuration_profile"},
		{"active mock", func(values map[string]CommandResult) {
			values["atlas-manager-service-lifecycle inspect"] = reportResult("inspect", "active_mock_verified", 0)
		}, "active_mock", "deactivate_service_before_deployment_mutation"},
		{"removed", func(values map[string]CommandResult) {
			values["atlas-manager-host-qualification verify-removed"] = reportResult("verify-removed", "removed", 0)
		}, "removed", "install_disabled_application"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := baseResults()
			test.configure(values)
			runner := &fakeRunner{results: values, errors: map[string]error{}}
			report := New(testPaths(t), runner).Run(context.Background(), Plan)
			if report.Result != "planned" || report.InstallationState != test.state || report.NextBoundary == nil || report.NextBoundary.Name != test.boundary {
				t.Fatalf("report = %#v", report)
			}
			if report.Safety.MutationExecuted || report.Safety.PowerManagementBackend != "mock" || report.Safety.MachinePowerEffectsActivation != "disabled" || report.Safety.MachinePowerSchedulerEnabled {
				t.Fatalf("unsafe report = %#v", report.Safety)
			}
			for _, call := range runner.calls {
				if call == "" || !strings.HasSuffix(call, " inspect") && call != "atlas-manager-installer inspect-bundle" && !strings.HasPrefix(call, "atlas-manager-host-qualification ") {
					t.Fatalf("unexpected mutation call %q", call)
				}
			}
		})
	}
}

func TestInspectReportsRecognizedStateWithoutBoundary(t *testing.T) {
	values := baseResults()
	values["atlas-manager-host-qualification qualify"] = reportResult("qualify", "qualified", 0)
	report := New(testPaths(t), &fakeRunner{results: values, errors: map[string]error{}}).Run(context.Background(), Inspect)
	if report.Result != "inspected" || report.InstallationState != "disabled_installation_ready" || report.NextBoundary != nil {
		t.Fatalf("report = %#v", report)
	}
	if _, err := report.Marshal(); err != nil {
		t.Fatal(err)
	}
}

func TestPlannerFailsClosedAndSkipsCascadeAfterBundleFailure(t *testing.T) {
	values := baseResults()
	values["atlas-manager-installer inspect-bundle"] = CommandResult{ExitCode: 1}
	report := New(testPaths(t), &fakeRunner{results: values, errors: map[string]error{}}).Run(context.Background(), Plan)
	if report.Result != "blocked" || len(report.Observations) != 9 || report.Observations[0].Code != "bundle_inspection_failed" {
		t.Fatalf("report = %#v", report)
	}
	for _, observation := range report.Observations[1:] {
		if observation.Status != "skipped" || observation.Code != "cascade_skipped" {
			t.Fatalf("cascade = %#v", observation)
		}
	}
}

func TestPlannerRejectsMalformedOversizedMismatchedAndFailedReports(t *testing.T) {
	tests := []struct {
		name   string
		result CommandResult
		err    error
		code   string
	}{
		{"missing", CommandResult{ExitCode: 0}, nil, "tool_report_missing"},
		{"malformed", CommandResult{Stdout: []byte("{"), ExitCode: 0}, nil, "tool_report_invalid"},
		{"trailing garbage", CommandResult{Stdout: []byte("{\"schemaVersion\":1,\"action\":\"inspect\",\"result\":\"absent\"}garbage"), ExitCode: 0}, nil, "tool_report_invalid"},
		{"oversized", CommandResult{Stdout: make([]byte, MaxOutputBytes+1), ExitCode: 0}, nil, "tool_report_oversized"},
		{"wrong action", reportResult("qualify", "qualified", 0), nil, "tool_report_invalid"},
		{"exit mismatch", reportResult("inspect", "absent", 1), nil, "tool_exit_report_mismatch"},
		{"unknown result", reportResult("inspect", "unknown", 0), nil, "tool_report_result_invalid"},
		{"runner failure", CommandResult{}, fmt.Errorf("tool_execution_failed"), "tool_execution_failed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			values := baseResults()
			values["atlas-manager-runtime-identity-installer inspect"] = test.result
			errors := map[string]error{}
			if test.err != nil {
				errors["atlas-manager-runtime-identity-installer inspect"] = test.err
			}
			report := New(testPaths(t), &fakeRunner{results: values, errors: errors}).Run(context.Background(), Plan)
			if report.Result != "blocked" || report.Observations[5].Code != test.code {
				t.Fatalf("report = %#v", report)
			}
		})
	}
}

func TestPlannerDoesNotTreatInterruptedOrUnmanagedStateAsSafe(t *testing.T) {
	tests := []struct {
		key    string
		result CommandResult
	}{
		{"atlas-manager-runtime-configuration inspect", reportResult("inspect", "interrupted", 1)},
		{"atlas-manager-runtime-identity-installer inspect", reportResult("inspect", "exact_unmanaged", 0)},
	}
	for _, test := range tests {
		values := baseResults()
		values["atlas-manager-host-qualification qualify"] = reportResult("qualify", "qualified", 0)
		values[test.key] = test.result
		report := New(testPaths(t), &fakeRunner{results: values, errors: map[string]error{}}).Run(context.Background(), Plan)
		if report.Result != "blocked" || report.NextBoundary != nil || report.InstallationState != "blocked" {
			t.Fatalf("report = %#v", report)
		}
	}
}
