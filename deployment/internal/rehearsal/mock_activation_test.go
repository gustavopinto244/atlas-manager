package rehearsal

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitypreparation"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identityreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeconfiguration"
	"github.com/atlas-manager/atlas-manager/deployment/internal/servicelifecycle"
)

type fakeSystemctl struct {
	enabled  bool
	active   bool
	commands []string
	failure  string
	failures []string
}

func (fake *fakeSystemctl) Run(_ context.Context, path string, args []string) (servicelifecycle.CommandResult, error) {
	if !strings.HasSuffix(path, "/usr/bin/systemctl") {
		return servicelifecycle.CommandResult{}, fmt.Errorf("systemctl_path_invalid")
	}
	command := strings.Join(args, " ")
	fake.commands = append(fake.commands, command)
	if fake.failure != "" && strings.HasPrefix(command, fake.failure) {
		return servicelifecycle.CommandResult{ExitCode: 1}, nil
	}
	if len(fake.failures) > 0 && strings.HasPrefix(command, fake.failures[0]) {
		fake.failures = fake.failures[1:]
		return servicelifecycle.CommandResult{ExitCode: 1}, nil
	}
	switch command {
	case "daemon-reload":
		return servicelifecycle.CommandResult{}, nil
	case "enable atlas-manager.service":
		fake.enabled = true
		return servicelifecycle.CommandResult{}, nil
	case "start atlas-manager.service":
		fake.active = true
		return servicelifecycle.CommandResult{}, nil
	case "stop atlas-manager.service":
		fake.active = false
		return servicelifecycle.CommandResult{}, nil
	case "disable atlas-manager.service":
		fake.enabled = false
		return servicelifecycle.CommandResult{}, nil
	case "is-enabled atlas-manager.service":
		if fake.enabled {
			return servicelifecycle.CommandResult{Stdout: "enabled\n"}, nil
		}
		return servicelifecycle.CommandResult{Stdout: "disabled\n"}, nil
	case "is-active atlas-manager.service":
		if fake.active {
			return servicelifecycle.CommandResult{Stdout: "active\n"}, nil
		}
		return servicelifecycle.CommandResult{Stdout: "inactive\n"}, nil
	case "show atlas-manager.service --property=LoadState --property=ActiveState --property=SubState --property=UnitFileState --property=MainPID --property=ExecMainStatus --no-pager":
		activeState, subState, unitState, pid := "inactive", "dead", "disabled", "0"
		if fake.enabled {
			unitState = "enabled"
		}
		if fake.active {
			activeState, subState, pid = "active", "running", "4242"
		}
		return servicelifecycle.CommandResult{Stdout: "LoadState=loaded\nActiveState=" + activeState + "\nSubState=" + subState + "\nUnitFileState=" + unitState + "\nMainPID=" + pid + "\nExecMainStatus=0\n"}, nil
	default:
		return servicelifecycle.CommandResult{ExitCode: 2}, nil
	}
}

func TestMockOnlyActivationLifecycleRehearsal(t *testing.T) {
	root := t.TempDir()
	bundleRoot, _, _ := buildRelease(t, root, "0.1.0", commitA)
	f := newFixture(t, root, bundleRoot)
	if err := writeFile(filepath.Join(f.host, "usr/bin/systemctl"), "synthetic systemctl\n", 0o755); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	if report, err := runtimeconfiguration.New(runtimeConfigurationPaths(f), runtimeconfiguration.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }}).Run(ctx, runtimeconfiguration.Inspect, ""); err != nil || report.Result != "absent" {
		t.Fatalf("configuration inspect: %+v %v", report, err)
	}
	if report, err := runIdentityPreparation(ctx, f); err != nil || report.Result != "prepared" {
		t.Fatalf("identity preparation: %+v %v", report, err)
	}
	if err := installerFor(f, f.bundleA).Run(ctx, installer.InstallDisabled); err != nil {
		t.Fatalf("disabled deployment install: %v", err)
	}
	if report, err := runtimeconfiguration.New(runtimeConfigurationPaths(f), runtimeconfiguration.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }}).Run(ctx, runtimeconfiguration.InstallMock, runtimeconfiguration.InstallConfirmation); err != nil || report.Result != "installed_mock" {
		t.Fatalf("configuration install: %+v %v", report, err)
	}
	if report, err := runtimeconfiguration.New(runtimeConfigurationPaths(f), runtimeconfiguration.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }}).Run(ctx, runtimeconfiguration.VerifyMock, ""); err != nil || report.Result != "verified_mock" {
		t.Fatalf("configuration verify: %+v %v", report, err)
	}

	fake := &fakeSystemctl{}
	servicePaths := serviceLifecyclePaths(f)
	service := servicelifecycle.New(servicePaths, servicelifecycle.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }, Executor: fake, Health: func(context.Context, int) error { return nil }})
	if report, err := service.Run(ctx, servicelifecycle.Inspect, ""); err != nil || report.Result != "ready_for_activation" {
		t.Fatalf("service inspect: %+v %v", report, err)
	}
	if report, err := service.Run(ctx, servicelifecycle.ActivateMock, servicelifecycle.ActivationConfirmation); err != nil || report.Result != "active_mock_verified" {
		t.Fatalf("activation: %+v %v", report, err)
	}
	if report, err := service.Run(ctx, servicelifecycle.VerifyActiveMock, ""); err != nil || report.Result != "active_mock_verified" {
		t.Fatalf("active verification: %+v %v", report, err)
	}
	if report, err := service.Run(ctx, servicelifecycle.Deactivate, servicelifecycle.DeactivationConfirmation); err != nil || report.Result != "deactivated" {
		t.Fatalf("deactivation: %+v %v", report, err)
	}
	if report, err := service.Run(ctx, servicelifecycle.VerifyInactive, ""); err != nil || report.Result != "inactive" {
		t.Fatalf("inactive verification: %+v %v", report, err)
	}
	if report, err := runtimeconfiguration.New(runtimeConfigurationPaths(f), runtimeconfiguration.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }}).Run(ctx, runtimeconfiguration.RemoveMock, runtimeconfiguration.RemoveConfirmation); err != nil || report.Result != "removed" {
		t.Fatalf("configuration remove: %+v %v", report, err)
	}
	if err := installerFor(f, f.bundleA).Run(ctx, installer.VerifyDisabled); err != nil {
		t.Fatalf("disabled deployment was not preserved: %v", err)
	}
	if fake.enabled || fake.active {
		t.Fatal("fake service remained active or enabled")
	}
	if len(fake.commands) == 0 || fake.commands[0] != "show atlas-manager.service --property=LoadState --property=ActiveState --property=SubState --property=UnitFileState --property=MainPID --property=ExecMainStatus --no-pager" {
		t.Fatalf("unexpected systemctl ledger: %v", fake.commands)
	}
}

func TestMockActivationFailureRollsBackServiceMutation(t *testing.T) {
	f, service, fake := preparedMockService(t)
	fake.failure = "start atlas-manager.service"
	report, err := service.Run(context.Background(), servicelifecycle.ActivateMock, servicelifecycle.ActivationConfirmation)
	if err != nil || report.Result != "activation_failed_rolled_back" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if fake.enabled || fake.active {
		t.Fatal("activation rollback left service enabled or active")
	}
	if _, err := os.Stat(serviceLifecyclePaths(f).Journal); !os.IsNotExist(err) {
		t.Fatal("successful rollback did not remove journal")
	}
}

func TestMockActivationIncompleteRollbackPreservesJournal(t *testing.T) {
	f, service, fake := preparedMockService(t)
	fake.failures = []string{"start atlas-manager.service", "stop atlas-manager.service"}
	report, err := service.Run(context.Background(), servicelifecycle.ActivateMock, servicelifecycle.ActivationConfirmation)
	if err != nil || report.Result != "activation_failed_recovery_required" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := os.Stat(serviceLifecyclePaths(f).Journal); err != nil {
		t.Fatalf("journal was not preserved: %v", err)
	}
	blocked, err := service.Run(context.Background(), servicelifecycle.ActivateMock, servicelifecycle.ActivationConfirmation)
	if err != nil || blocked.Result != "blocked" {
		t.Fatalf("interrupted activation was not blocked: %+v %v", blocked, err)
	}
}

func preparedMockService(t *testing.T) (*fixture, servicelifecycle.Service, *fakeSystemctl) {
	t.Helper()
	root := t.TempDir()
	bundleRoot, _, _ := buildRelease(t, root, "0.1.0", commitA)
	f := newFixture(t, root, bundleRoot)
	if err := writeFile(filepath.Join(f.host, "usr/bin/systemctl"), "synthetic systemctl\n", 0o755); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if report, err := runIdentityPreparation(ctx, f); err != nil || report.Result != "prepared" {
		t.Fatalf("identity preparation: %+v %v", report, err)
	}
	if err := installerFor(f, f.bundleA).Run(ctx, installer.InstallDisabled); err != nil {
		t.Fatal(err)
	}
	if report, err := runtimeconfiguration.New(runtimeConfigurationPaths(f), runtimeconfiguration.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }}).Run(ctx, runtimeconfiguration.InstallMock, runtimeconfiguration.InstallConfirmation); err != nil || report.Result != "installed_mock" {
		t.Fatalf("configuration: %+v %v", report, err)
	}
	fake := &fakeSystemctl{}
	return f, servicelifecycle.New(serviceLifecyclePaths(f), servicelifecycle.Dependencies{EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" }, Executor: fake, Health: func(context.Context, int) error { return nil }}), fake
}

func runIdentityPreparation(ctx context.Context, f *fixture) (identityreport.Report, error) {
	return identitypreparation.New(f.identity, f.identityDependencies()).Run(ctx, identitypreparation.PrepareDisabled, identitypreparation.Confirmation)
}

func runtimeConfigurationPaths(f *fixture) runtimeconfiguration.Paths {
	paths := runtimeconfiguration.ProductionPaths(f.bundleA)
	paths.BundleRoot, paths.Passwd, paths.Group = f.bundleA, filepath.Join(f.host, "etc/passwd"), filepath.Join(f.host, "etc/group")
	paths.Environment, paths.ConfigDir = filepath.Join(f.host, "etc/atlas-manager/atlas-manager.env"), filepath.Join(f.host, "etc/atlas-manager")
	paths.StateDirectory, paths.StateFile = filepath.Join(f.host, "var/lib/atlas-manager-runtime-configuration"), filepath.Join(f.host, "var/lib/atlas-manager-runtime-configuration/state.json")
	paths.Journal, paths.Lock = filepath.Join(f.host, "var/lib/atlas-manager-runtime-configuration/transaction.json"), filepath.Join(f.host, "run/atlas-manager-runtime-configuration.lock")
	paths.Deployment, paths.IdentityState, paths.IdentityJournal = f.deployment, filepath.Join(f.host, "var/lib/atlas-manager-identity-preparation/state.json"), filepath.Join(f.host, "var/lib/atlas-manager-identity-preparation/transaction.json")
	paths.RuntimeActivity, paths.ServiceEnablement = f.deployment.RuntimeDir, f.deployment.EnableLink
	return paths
}

func serviceLifecyclePaths(f *fixture) servicelifecycle.Paths {
	paths := servicelifecycle.ProductionPaths(f.bundleA)
	paths.BundleRoot, paths.Deployment = f.bundleA, f.deployment
	paths.Passwd, paths.Group = filepath.Join(f.host, "etc/passwd"), filepath.Join(f.host, "etc/group")
	paths.ConfigEnvironment, paths.ConfigState = filepath.Join(f.host, "etc/atlas-manager/atlas-manager.env"), filepath.Join(f.host, "var/lib/atlas-manager-runtime-configuration/state.json")
	paths.IdentityState, paths.IdentityJournal = filepath.Join(f.host, "var/lib/atlas-manager-identity-preparation/state.json"), filepath.Join(f.host, "var/lib/atlas-manager-identity-preparation/transaction.json")
	paths.StateDirectory, paths.StateFile = filepath.Join(f.host, "var/lib/atlas-manager-service-lifecycle"), filepath.Join(f.host, "var/lib/atlas-manager-service-lifecycle/state.json")
	paths.Journal, paths.Lock, paths.Systemctl = filepath.Join(f.host, "var/lib/atlas-manager-service-lifecycle/transaction.json"), filepath.Join(f.host, "run/atlas-manager-service-lifecycle.lock"), filepath.Join(f.host, "usr/bin/systemctl")
	return paths
}
