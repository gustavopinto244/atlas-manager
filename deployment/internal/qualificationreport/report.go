package qualificationreport

import (
	"encoding/json"
	"fmt"
)

const (
	SchemaVersion = 1
	MaxBytes      = 64 * 1024
	MaxChecks     = 32
	MaxCodeLength = 96
)

type Status string

const (
	Passed        Status = "passed"
	Warning       Status = "warning"
	Blocked       Status = "blocked"
	NotApplicable Status = "not_applicable"
)

type Check struct {
	Name   string `json:"name"`
	Status Status `json:"status"`
	Code   string `json:"code"`
}

type Report struct {
	SchemaVersion   int     `json:"schemaVersion"`
	Action          string  `json:"action"`
	Result          string  `json:"result"`
	Bundle          Check   `json:"bundle"`
	Platform        Check   `json:"platform"`
	NodeRuntime     Check   `json:"nodeRuntime"`
	Systemd         Check   `json:"systemd"`
	Filesystem      Check   `json:"filesystem"`
	RuntimeIdentity Check   `json:"runtimeIdentity"`
	Deployment      Check   `json:"deployment"`
	Configuration   Check   `json:"configuration"`
	Preparation     Check   `json:"identityPreparation"`
	Checks          []Check `json:"checks"`
}

func (report Report) Marshal() ([]byte, error) {
	if report.Preparation.Name == "" {
		report.Preparation = Check{Name: "identity_preparation", Status: NotApplicable, Code: "preparation_not_inspected"}
	}
	if report.SchemaVersion != SchemaVersion || !validAction(report.Action) || !validResult(report.Result) || len(report.Action) > MaxCodeLength || len(report.Result) > MaxCodeLength || len(report.Checks) > MaxChecks {
		return nil, fmt.Errorf("qualification_report_invalid")
	}
	for _, check := range append([]Check{report.Bundle, report.Platform, report.NodeRuntime, report.Systemd, report.Filesystem, report.RuntimeIdentity, report.Deployment, report.Configuration, report.Preparation}, report.Checks...) {
		if check.Name == "" || len(check.Name) > MaxCodeLength || len(check.Code) > MaxCodeLength || !validStatus(check.Status) {
			return nil, fmt.Errorf("qualification_report_invalid")
		}
	}
	data, err := json.Marshal(report)
	if err != nil || len(data)+1 > MaxBytes {
		return nil, fmt.Errorf("qualification_report_oversized")
	}
	return append(data, '\n'), nil
}

func validStatus(status Status) bool {
	return status == Passed || status == Warning || status == Blocked || status == NotApplicable
}

func validAction(action string) bool {
	return action == "qualify" || action == "verify-prepared" || action == "verify-disabled-installation" || action == "verify-removed"
}

func validResult(result string) bool {
	return result == "qualified" || result == "preparation_required" || result == "prepared" || result == "disabled_installation_verified" || result == "removed" || result == "blocked"
}
