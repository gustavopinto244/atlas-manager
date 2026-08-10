package qualification

import (
	"context"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/hostinspection"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

func TestQualificationResultsRemainSeparateGates(t *testing.T) {
	tests := []struct {
		name       string
		action     Action
		identity   runtimeidentity.State
		deployment hostinspection.DeploymentState
		want       string
	}{
		{"qualify absent", Qualify, runtimeidentity.Absent, hostinspection.DeploymentAbsent, "preparation_required"},
		{"qualify ready", Qualify, runtimeidentity.Ready, hostinspection.DeploymentAbsent, "qualified"},
		{"prepared", VerifyPrepared, runtimeidentity.Ready, hostinspection.DeploymentAbsent, "prepared"},
		{"disabled", VerifyDisabledInstallation, runtimeidentity.Ready, hostinspection.DeploymentManaged, "disabled_installation_verified"},
		{"removed", VerifyRemoved, runtimeidentity.Absent, hostinspection.DeploymentAbsent, "removed"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			report, err := Run(context.Background(), test.action, hostinspection.StaticInspector{Value: safeSnapshot(test.identity, test.deployment)})
			if err != nil {
				t.Fatal(err)
			}
			if report.Result != test.want {
				t.Fatalf("result = %q, want %q", report.Result, test.want)
			}
		})
	}
}

func TestQualificationBlocksUnsafeState(t *testing.T) {
	snapshot := safeSnapshot(runtimeidentity.Ready, hostinspection.DeploymentAbsent)
	snapshot.Platform = qualificationreport.Check{Name: "platform", Status: qualificationreport.Blocked, Code: "unsupported_platform"}
	report, err := Run(context.Background(), Qualify, hostinspection.StaticInspector{Value: snapshot})
	if err != nil || report.Result != "blocked" {
		t.Fatalf("report = %#v, err = %v", report, err)
	}
	if _, err := report.Marshal(); err != nil {
		t.Fatal(err)
	}
}

func safeSnapshot(identity runtimeidentity.State, deployment hostinspection.DeploymentState) hostinspection.Snapshot {
	identityStatus := qualificationreport.Passed
	identityCode := "runtime_identity_ready"
	if identity == runtimeidentity.Absent {
		identityStatus = qualificationreport.Warning
		identityCode = "runtime_identity_absent"
	}
	return hostinspection.Snapshot{
		Bundle:          qualificationreport.Check{Name: "bundle", Status: qualificationreport.Passed, Code: "bundle_valid"},
		Platform:        qualificationreport.Check{Name: "platform", Status: qualificationreport.Passed, Code: "linux_amd64_root"},
		NodeRuntime:     qualificationreport.Check{Name: "node_runtime", Status: qualificationreport.Passed, Code: "node_runtime_supported"},
		Systemd:         qualificationreport.Check{Name: "systemd", Status: qualificationreport.Passed, Code: "systemd_available"},
		Filesystem:      qualificationreport.Check{Name: "filesystem", Status: qualificationreport.Passed, Code: "filesystem_safe"},
		RuntimeIdentity: qualificationreport.Check{Name: "runtime_identity", Status: identityStatus, Code: identityCode},
		IdentityState:   identity,
		Deployment:      qualificationreport.Check{Name: "deployment", Status: qualificationreport.Passed, Code: string(deployment)},
		DeploymentState: deployment,
		Configuration:   qualificationreport.Check{Name: "configuration", Status: qualificationreport.Passed, Code: "configuration_absent"},
		Lock:            qualificationreport.Check{Name: "deployment_lock", Status: qualificationreport.Passed, Code: "deployment_lock_absent"},
		Runtime:         qualificationreport.Check{Name: "runtime_activity", Status: qualificationreport.Passed, Code: "runtime_inactive"},
		Enablement:      qualificationreport.Check{Name: "service_enablement", Status: qualificationreport.Passed, Code: "service_disabled"},
	}
}
