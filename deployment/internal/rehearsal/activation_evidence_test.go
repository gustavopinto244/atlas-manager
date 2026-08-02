package rehearsal

import (
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/activationreport"
)

func TestActivationEvidenceIsBoundedAndDeterministic(t *testing.T) {
	const hash = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	evidence := activationreport.Evidence{
		SchemaVersion: 1, Result: "active_mock_verified", SourceCommit: commitA,
		ApplicationVersion: "0.1.0", DeploymentBundleSHA256: hash,
		RuntimeConfigurationSHA256: hash, SystemdUnitSHA256: hash,
		ActivationSteps: []activationreport.Step{{Sequence: 1, Action: "activate-mock", Status: "passed", ReportSHA256: hash}},
		HealthChecks:    []activationreport.Step{{Sequence: 1, Action: "health", Status: "passed", ReportSHA256: hash}},
		FinalState:      "active_mock_verified",
	}
	first, err := evidence.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	second, err := evidence.Marshal()
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != string(second) {
		t.Fatal("activation evidence is not deterministic")
	}
	if activationreport.Chain("", activationreport.Digest(first)) == "" {
		t.Fatal("evidence chain digest missing")
	}
}
