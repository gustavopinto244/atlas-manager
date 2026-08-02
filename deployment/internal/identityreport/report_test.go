package identityreport

import "testing"

func TestMarshalProducesBoundedCanonicalReport(t *testing.T) {
	report := Report{
		SchemaVersion: 1,
		Action:        "inspect",
		Result:        "absent",
		IdentityState: "absent",
		ManagedState:  Check{Name: "managed_state", Status: Passed, Code: "managed_state_absent"},
		Transaction:   Check{Name: "transaction", Status: Passed, Code: "transaction_absent"},
		Checks:        []Check{{Name: "identity_state", Status: Warning, Code: "absent"}},
	}
	data, err := report.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if len(data) == 0 || data[len(data)-1] != '\n' {
		t.Fatal("report does not end with one newline")
	}
	if len(data) > MaxBytes {
		t.Fatal("report exceeds bound")
	}
}

func TestMarshalRejectsUnknownResultAndOversizedChecks(t *testing.T) {
	report := Report{SchemaVersion: 1, Action: "inspect", Result: "unknown", IdentityState: "absent"}
	if _, err := report.Marshal(); err == nil {
		t.Fatal("unknown result accepted")
	}
	report.Result = "absent"
	for index := 0; index < 33; index++ {
		report.Checks = append(report.Checks, Check{Name: "check", Status: Passed, Code: "ok"})
	}
	if _, err := report.Marshal(); err == nil {
		t.Fatal("oversized check collection accepted")
	}
}
