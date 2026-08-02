package identitypreparation

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitycommand"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
)

type fakeAccountExecutor struct {
	passwd   string
	group    string
	fail     string
	failPath string
	paths    Paths
	seen     []string
}

func (executor *fakeAccountExecutor) Run(_ context.Context, path string, args []string) identitycommand.Result {
	name := args[len(args)-1]
	executor.seen = append(executor.seen, path+" "+strings.Join(args, " "))
	if name == executor.fail || path == executor.failPath {
		return identitycommand.Result{ExitCode: 1}
	}
	switch path {
	case identitycommand.PrimaryGroupTool:
		if name == "atlas-manager" {
			executor.group += "atlas-manager:x:1001:\n"
		} else {
			executor.group += "atlas-manager-power:x:1002:\n"
		}
	case identitycommand.UserTool:
		executor.passwd += "atlas-manager:x:1003:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"
	case identitycommand.UserDeleteTool:
		executor.passwd = removeLine(executor.passwd, "atlas-manager")
	case identitycommand.GroupDeleteTool:
		executor.group = removeLine(executor.group, name)
	}
	if err := os.WriteFile(executor.paths.Passwd, []byte(executor.passwd), 0o600); err != nil {
		return identitycommand.Result{ExitCode: 2}
	}
	if err := os.WriteFile(executor.paths.Group, []byte(executor.group), 0o600); err != nil {
		return identitycommand.Result{ExitCode: 2}
	}
	return identitycommand.Result{}
}

func removeLine(value, name string) string {
	lines := strings.Split(value, "\n")
	kept := lines[:0]
	for _, line := range lines {
		if fields := strings.Split(line, ":"); len(fields) > 0 && fields[0] == name {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

func testPreparation(t *testing.T, hostResult string, executor *fakeAccountExecutor) Preparation {
	t.Helper()
	root := t.TempDir()
	paths := ProductionPaths(filepath.Join(root, "bundle"))
	paths.Passwd = filepath.Join(root, "etc/passwd")
	paths.Group = filepath.Join(root, "etc/group")
	paths.Shadow = filepath.Join(root, "etc/shadow")
	paths.GShadow = filepath.Join(root, "etc/gshadow")
	paths.Etc = filepath.Join(root, "etc")
	paths.Usr = filepath.Join(root, "usr")
	paths.UsrSbin = filepath.Join(root, "usr/sbin")
	paths.Helper = filepath.Join(root, "usr/local/libexec/helper")
	paths.RuntimeHome = filepath.Join(root, "var/lib/atlas-manager")
	paths.ApplicationState = paths.RuntimeHome
	paths.DeploymentRoot = filepath.Join(root, "opt/atlas-manager")
	paths.DeploymentCurrent = filepath.Join(paths.DeploymentRoot, "current")
	paths.DeploymentReleases = filepath.Join(paths.DeploymentRoot, "releases")
	paths.DeploymentUnit = filepath.Join(root, "etc/systemd/system/atlas-manager.service")
	paths.DeploymentEnable = filepath.Join(root, "etc/systemd/system/multi-user.target.wants/atlas-manager.service")
	paths.DeploymentState = filepath.Join(root, "var/lib/atlas-manager-deployment/state.json")
	paths.DeploymentLock = filepath.Join(root, "run/atlas-manager-deployment.lock")
	paths.RuntimeActivity = filepath.Join(root, "run/atlas-manager")
	paths.Configuration = filepath.Join(root, "etc/atlas-manager/atlas-manager.env")
	paths.StateDirectory = filepath.Join(root, "var/lib/atlas-manager-identity-preparation")
	paths.StateFile = filepath.Join(paths.StateDirectory, "state.json")
	paths.Journal = filepath.Join(paths.StateDirectory, "transaction.json")
	paths.Lock = filepath.Join(root, "run/atlas-manager-identity-preparation.lock")
	_ = os.MkdirAll(filepath.Dir(paths.Passwd), 0o755)
	_ = os.MkdirAll(filepath.Dir(paths.RuntimeHome), 0o755)
	_ = os.MkdirAll(filepath.Dir(paths.Lock), 0o755)
	executor.paths = paths
	executor.passwd = "root:x:0:0:root:/root:/bin/sh\n"
	executor.group = "root:x:0:\n"
	_ = os.WriteFile(paths.Passwd, []byte(executor.passwd), 0o600)
	_ = os.WriteFile(paths.Group, []byte(executor.group), 0o600)
	return New(paths, Dependencies{
		EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" },
		ValidateTool: func(string) error { return nil }, ValidateDirectory: func(string) error { return nil }, Executor: executor,
		ValidateAccountFile: func(string) error { return nil }, ValidatePrivatePath: func(string) error { return nil },
		HostQualify: func(context.Context) (qualificationreport.Report, error) {
			return qualificationreport.Report{Result: hostResult}, nil
		},
		BundleMetadata: func(string) (string, string, error) { return "0123456789abcdef0123456789abcdef01234567", "0.1.0", nil },
	})
}

func TestPrepareDisabledCreatesManagedIdentityWithoutHome(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if len(executor.seen) != 3 || !strings.HasPrefix(executor.seen[0], identitycommand.PrimaryGroupTool) || !strings.HasPrefix(executor.seen[1], identitycommand.HelperGroupTool) || !strings.HasPrefix(executor.seen[2], identitycommand.UserTool) {
		t.Fatalf("commands=%v", executor.seen)
	}
	if _, err := os.Stat(preparation.paths.RuntimeHome); !os.IsNotExist(err) {
		t.Fatal("home was created")
	}
	if _, err := os.Stat(preparation.paths.Journal); !os.IsNotExist(err) {
		t.Fatal("journal was retained after success")
	}
	verifyPreparation := New(preparation.paths, Dependencies{
		EffectiveUID: func() int { return 0 }, Platform: func() string { return "linux" }, Architecture: func() string { return "amd64" },
		ValidateTool: func(string) error { return nil }, ValidateDirectory: func(string) error { return nil }, Executor: executor,
		ValidateAccountFile: func(string) error { return nil }, ValidatePrivatePath: func(string) error { return nil },
		HostQualify: func(context.Context) (qualificationreport.Report, error) {
			return qualificationreport.Report{Result: "qualified"}, nil
		},
		BundleMetadata: func(string) (string, string, error) { return "0123456789abcdef0123456789abcdef01234567", "0.1.0", nil },
	})
	verify, err := verifyPreparation.Run(context.Background(), VerifyManaged, "")
	if err != nil || verify.Result != "managed_prepared" {
		t.Fatalf("verify=%s err=%v", verify.Result, err)
	}
}

func TestPrepareDisabledRejectsExactUnmanagedIdentity(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	executor.group = "root:x:0:\natlas-manager:x:1001:\natlas-manager-power:x:1002:\n"
	executor.passwd = "root:x:0:0:root:/root:/bin/sh\natlas-manager:x:1003:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"
	_ = os.WriteFile(preparation.paths.Group, []byte(executor.group), 0o600)
	_ = os.WriteFile(preparation.paths.Passwd, []byte(executor.passwd), 0o600)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
}

func TestPrepareDisabledRollsBackCurrentAttemptOnUserFailure(t *testing.T) {
	executor := &fakeAccountExecutor{failPath: identitycommand.UserTool}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "preparation_failed_rolled_back" {
		t.Fatalf("report=%+v err=%v commands=%v group=%q passwd=%q", report, err, executor.seen, executor.group, executor.passwd)
	}
	if strings.Contains(executor.group, "atlas-manager:x:") || strings.Contains(executor.group, "atlas-manager-power:x:") {
		t.Fatalf("created groups remained: %s", executor.group)
	}
	if strings.Contains(executor.passwd, "atlas-manager:x:") {
		t.Fatal("created user remained")
	}
	if _, err := os.Stat(preparation.paths.Journal); !os.IsNotExist(err) {
		t.Fatal("journal should be removed after complete rollback")
	}
}

func TestPrepareDisabledBlocksInterruptedJournal(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	journal := `{"schemaVersion":1,"status":"in_progress","resources":["primary_group","helper_group","runtime_user"],"completedSteps":[],"sourceCommit":"0123456789abcdef0123456789abcdef01234567","bundleVersion":"0.1.0"}`
	if err := os.MkdirAll(preparation.paths.StateDirectory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.Journal, []byte(journal), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
}

func TestPrepareDisabledRequiresExactConfirmationWithoutMutation(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	for _, confirmation := range []string{"", "CONFIRM_ATLAS_MANAGER_RUNTIME_IDENTITY_PREPARATION", Confirmation + " ", "confirm_atlas_manager_runtime_identity"} {
		report, err := preparation.Run(context.Background(), PrepareDisabled, confirmation)
		if err != nil || report.Result != "blocked" {
			t.Fatalf("confirmation %q produced report=%+v err=%v", confirmation, report, err)
		}
	}
	if len(executor.seen) != 0 {
		t.Fatalf("invalid confirmation invoked commands: %v", executor.seen)
	}
}

func TestPrepareDisabledDoesNotRepairExistingPreparationLock(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.WriteFile(preparation.paths.Lock, []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
	if _, err := os.Stat(preparation.paths.Lock); err != nil {
		t.Fatalf("existing lock was removed: %v", err)
	}
}

func TestInspectUnsafeStateProducesBoundedBlockedReport(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.WriteFile(preparation.paths.Passwd, []byte("atlas-manager:malformed"), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), Inspect, "")
	if err != nil || report.Result != "blocked" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := report.Marshal(); err != nil {
		t.Fatalf("blocked report is not serializable: %v", err)
	}
}
