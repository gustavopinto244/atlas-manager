package qualification

import (
	"context"

	"github.com/atlas-manager/atlas-manager/deployment/internal/hostinspection"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
)

type Action string

const (
	Qualify                    Action = "qualify"
	VerifyPrepared             Action = "verify-prepared"
	VerifyDisabledInstallation Action = "verify-disabled-installation"
	VerifyRemoved              Action = "verify-removed"
)

func ValidAction(value string) bool {
	return value == string(Qualify) || value == string(VerifyPrepared) || value == string(VerifyDisabledInstallation) || value == string(VerifyRemoved)
}

type Inspector interface {
	Inspect(context.Context) hostinspection.Snapshot
}

func Run(ctx context.Context, action Action, inspector Inspector) (qualificationreport.Report, error) {
	snapshot := inspector.Inspect(ctx)
	result := resultFor(action, snapshot)
	report := qualificationreport.Report{
		SchemaVersion:   qualificationreport.SchemaVersion,
		Action:          string(action),
		Result:          result,
		Bundle:          snapshot.Bundle,
		Platform:        snapshot.Platform,
		NodeRuntime:     snapshot.NodeRuntime,
		Systemd:         snapshot.Systemd,
		Filesystem:      snapshot.Filesystem,
		RuntimeIdentity: snapshot.RuntimeIdentity,
		Deployment:      snapshot.Deployment,
		Configuration:   snapshot.Configuration,
		Checks:          []qualificationreport.Check{snapshot.Lock, snapshot.Runtime, snapshot.Enablement},
	}
	return report, nil
}

func resultFor(action Action, snapshot hostinspection.Snapshot) string {
	if action == VerifyRemoved {
		if snapshot.Platform.Status == qualificationreport.Blocked || snapshot.Bundle.Status == qualificationreport.Blocked || snapshot.Systemd.Status == qualificationreport.Blocked || snapshot.Filesystem.Status == qualificationreport.Blocked || snapshot.RuntimeIdentity.Status == qualificationreport.Blocked || snapshot.Configuration.Status == qualificationreport.Blocked || snapshot.Lock.Status == qualificationreport.Blocked || snapshot.Runtime.Status == qualificationreport.Blocked || snapshot.Enablement.Status == qualificationreport.Blocked || snapshot.DeploymentState != hostinspection.DeploymentAbsent {
			return "blocked"
		}
		return "removed"
	}
	if hasBlocked(snapshot) {
		return "blocked"
	}
	switch action {
	case Qualify:
		if snapshot.DeploymentState != hostinspection.DeploymentAbsent {
			return "blocked"
		}
		if snapshot.IdentityState == runtimeidentity.Absent {
			return "preparation_required"
		}
		return "qualified"
	case VerifyPrepared:
		if snapshot.IdentityState != runtimeidentity.Ready || snapshot.DeploymentState != hostinspection.DeploymentAbsent {
			return "blocked"
		}
		return "prepared"
	case VerifyDisabledInstallation:
		if snapshot.IdentityState != runtimeidentity.Ready || snapshot.DeploymentState != hostinspection.DeploymentManaged {
			return "blocked"
		}
		return "disabled_installation_verified"
	default:
		return "blocked"
	}
}

func hasBlocked(snapshot hostinspection.Snapshot) bool {
	for _, check := range []qualificationreport.Check{snapshot.Bundle, snapshot.Platform, snapshot.NodeRuntime, snapshot.Systemd, snapshot.Filesystem, snapshot.RuntimeIdentity, snapshot.Deployment, snapshot.Configuration, snapshot.Lock, snapshot.Runtime, snapshot.Enablement} {
		if check.Status == qualificationreport.Blocked {
			return true
		}
	}
	return false
}
