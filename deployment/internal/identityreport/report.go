package identityreport

import (
	"encoding/json"
	"fmt"

	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
)

const MaxBytes = 64 * 1024

type Check = qualificationreport.Check
type Status = qualificationreport.Status

const (
	Passed        = qualificationreport.Passed
	Warning       = qualificationreport.Warning
	Blocked       = qualificationreport.Blocked
	NotApplicable = qualificationreport.NotApplicable
)

type Report struct {
	SchemaVersion int     `json:"schemaVersion"`
	Action        string  `json:"action"`
	Result        string  `json:"result"`
	IdentityState string  `json:"identityState"`
	ManagedState  Check   `json:"managedState"`
	Transaction   Check   `json:"transaction"`
	Checks        []Check `json:"checks"`
}

func (report Report) Marshal() ([]byte, error) {
	if report.SchemaVersion != qualificationreport.SchemaVersion || !validAction(report.Action) || !validResult(report.Result) || report.IdentityState == "" || len(report.Checks) > 32 {
		return nil, fmt.Errorf("identity_report_invalid")
	}
	checks := append([]Check{report.ManagedState, report.Transaction}, report.Checks...)
	for _, check := range checks {
		if check.Name == "" || len(check.Name) > qualificationreport.MaxCodeLength || len(check.Code) > qualificationreport.MaxCodeLength || !validStatus(check.Status) {
			return nil, fmt.Errorf("identity_report_invalid")
		}
	}
	data, err := json.Marshal(report)
	if err != nil || len(data)+1 > MaxBytes {
		return nil, fmt.Errorf("identity_report_oversized")
	}
	return append(data, '\n'), nil
}

func validAction(value string) bool {
	return value == "inspect" || value == "prepare-disabled" || value == "verify-managed"
}

func validResult(value string) bool {
	return value == "absent" || value == "prepared" || value == "managed_prepared" || value == "exact_unmanaged" || value == "blocked" || value == "interrupted" || value == "preparation_failed_rolled_back" || value == "preparation_failed_recovery_required"
}

func validStatus(value Status) bool {
	return value == Passed || value == Warning || value == Blocked || value == NotApplicable
}
