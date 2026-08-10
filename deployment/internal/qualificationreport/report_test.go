package qualificationreport

import (
	"bytes"
	"testing"
)

func TestMarshalIsCanonicalAndBounded(t *testing.T) {
	report := Report{
		SchemaVersion: SchemaVersion, Action: "qualify", Result: "qualified",
		Bundle:          Check{Name: "bundle", Status: Passed, Code: "bundle_valid"},
		Platform:        Check{Name: "platform", Status: Passed, Code: "linux_amd64_root"},
		NodeRuntime:     Check{Name: "node_runtime", Status: Passed, Code: "node_runtime_supported"},
		Systemd:         Check{Name: "systemd", Status: Passed, Code: "systemd_available"},
		Filesystem:      Check{Name: "filesystem", Status: Passed, Code: "filesystem_safe"},
		RuntimeIdentity: Check{Name: "runtime_identity", Status: Warning, Code: "runtime_identity_absent"},
		Deployment:      Check{Name: "deployment", Status: Passed, Code: "deployment_absent"},
		Configuration:   Check{Name: "configuration", Status: Passed, Code: "configuration_absent"},
	}
	first, err := report.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	second, err := report.Marshal()
	if err != nil || !bytes.Equal(first, second) {
		t.Fatal("report serialization is not deterministic")
	}
	if len(first) > MaxBytes || first[len(first)-1] != '\n' {
		t.Fatal("report bounds or newline contract failed")
	}
}

func TestMarshalRejectsOversizedChecks(t *testing.T) {
	report := Report{SchemaVersion: SchemaVersion, Action: "qualify", Result: "blocked", Checks: make([]Check, MaxChecks+1)}
	if _, err := report.Marshal(); err == nil {
		t.Fatal("oversized report accepted")
	}
}
