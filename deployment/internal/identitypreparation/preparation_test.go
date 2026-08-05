package identitypreparation

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitycommand"
	"github.com/atlas-manager/atlas-manager/deployment/internal/identityreport"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualificationreport"
)

type fakeAccountExecutor struct {
	passwd         string
	group          string
	shadow         string
	fail           string
	failPath       string
	paths          Paths
	seen           []string
	help           string
	defaults       string
	packageResult  identitycommand.Result
	packageCalls   int
	mail           bool
	mutateLoginLog bool
}

func (executor *fakeAccountExecutor) Run(_ context.Context, path string, args []string) identitycommand.Result {
	if path == identitycommand.UserTool && len(args) == 1 && args[0] == "--help" {
		return identitycommand.Result{Stdout: []byte(executor.help)}
	}
	if path == identitycommand.UserTool && len(args) == 1 && args[0] == "-D" {
		return identitycommand.Result{Stdout: []byte(executor.defaults)}
	}
	if path == identitycommand.DpkgQueryTool {
		executor.packageCalls++
		if executor.packageResult.ExitCode != 0 || executor.packageResult.Stdout != nil || executor.packageResult.Stderr != nil {
			return executor.packageResult
		}
		return identitycommand.Result{Stdout: []byte("passwd\n1:4.17.4-2ubuntu3\nshadow\n1:4.17.4-2ubuntu3\namd64\n")}
	}
	name := args[len(args)-1]
	executor.seen = append(executor.seen, path+" "+strings.Join(args, " "))
	if path == identitycommand.UserTool && executor.mail {
		_ = os.MkdirAll(filepath.Dir(executor.paths.MailSpoolPaths[0]), 0o755)
		if err := os.WriteFile(executor.paths.MailSpoolPaths[0], []byte("residue"), 0o600); err != nil {
			return identitycommand.Result{ExitCode: 2}
		}
	}
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
		executor.shadow += "atlas-manager:!:19793:0:99999:7:::\n"
		if executor.mutateLoginLog {
			_ = os.WriteFile(executor.paths.LoginLogPaths[0], []byte("unexpected mutation"), 0o600)
		}
	case identitycommand.UserDeleteTool:
		executor.passwd = removeLine(executor.passwd, "atlas-manager")
		executor.shadow = removeLine(executor.shadow, "atlas-manager")
	case identitycommand.GroupDeleteTool:
		executor.group = removeLine(executor.group, name)
	}
	if err := os.WriteFile(executor.paths.Passwd, []byte(executor.passwd), 0o600); err != nil {
		return identitycommand.Result{ExitCode: 2}
	}
	if err := os.WriteFile(executor.paths.Group, []byte(executor.group), 0o600); err != nil {
		return identitycommand.Result{ExitCode: 2}
	}
	if err := os.WriteFile(executor.paths.Shadow, []byte(executor.shadow), 0o600); err != nil {
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
	paths.PamTally2 = filepath.Join(root, "sbin/pam_tally2")
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
	paths.MailSpoolPaths = []string{filepath.Join(root, "var/mail/atlas-manager"), filepath.Join(root, "var/spool/mail/atlas-manager")}
	paths.LoginLogPaths = []string{filepath.Join(root, "var/log/lastlog"), filepath.Join(root, "var/log/faillog"), filepath.Join(root, "var/log/tallylog")}
	_ = os.MkdirAll(filepath.Dir(paths.Passwd), 0o755)
	_ = os.MkdirAll(filepath.Dir(paths.RuntimeHome), 0o755)
	_ = os.MkdirAll(filepath.Dir(paths.Lock), 0o755)
	_ = os.MkdirAll(filepath.Dir(paths.LoginLogPaths[0]), 0o755)
	_ = os.MkdirAll(paths.UsrSbin, 0o755)
	_ = os.Symlink("usr/sbin", filepath.Join(root, "sbin"))
	executor.paths = paths
	executor.passwd = "root:x:0:0:root:/root:/bin/sh\n"
	executor.group = "root:x:0:\nsyslog:x:100:\nutmp:x:101:\n"
	executor.shadow = ""
	if executor.help == "" {
		executor.help = "  -r, --system\n  -M, --no-create-home\n  -N, --no-user-group\n  -g, --gid GROUP\n  -d, --home-dir HOME_DIR\n  -s, --shell SHELL\n"
	}
	if executor.defaults == "" {
		executor.defaults = "GROUP=100\nGROUPS=\nHOME=/home\nINACTIVE=-1\nEXPIRE=\nSHELL=/bin/sh\nSKEL=/etc/skel\nUSRSKEL=/usr/etc/skel\nCREATE_MAIL_SPOOL=no\nLOG_INIT=yes\n"
	}
	_ = os.WriteFile(paths.Passwd, []byte(executor.passwd), 0o600)
	_ = os.WriteFile(paths.Group, []byte(executor.group), 0o600)
	_ = os.WriteFile(paths.Shadow, []byte(executor.shadow), 0o600)
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
	if executor.shadow != "atlas-manager:!:19793:0:99999:7:::\n" {
		t.Fatalf("password state=%q", executor.shadow)
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

func passwordCheck(report identityreport.Report) qualificationreport.Check {
	for _, check := range report.Checks {
		if check.Name == "runtime_password" {
			return check
		}
	}
	return qualificationreport.Check{}
}

func writeExistingIdentity(t *testing.T, preparation Preparation, shadow string) {
	t.Helper()
	passwd := "root:x:0:0:root:/root:/bin/sh\natlas-manager:x:1003:1001::/var/lib/atlas-manager:/usr/sbin/nologin\n"
	group := "root:x:0:\natlas-manager:x:1001:\natlas-manager-power:x:1002:\n"
	if err := os.WriteFile(preparation.paths.Passwd, []byte(passwd), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.Group, []byte(group), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.Shadow, []byte(shadow), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestInspectCleanAbsentIdentityAllowsAbsentPasswordState(t *testing.T) {
	preparation := testPreparation(t, "preparation_required", &fakeAccountExecutor{})
	report, err := preparation.Run(context.Background(), Inspect, "")
	if err != nil || report.Result != "absent" || report.IdentityState != "absent" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	check := passwordCheck(report)
	if check.Status != qualificationreport.NotApplicable || check.Code != "runtime_password_absent" {
		t.Fatalf("password check=%+v", check)
	}
}

func TestPrepareDisabledRejectsResidualShadowEntryWithoutMutation(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.WriteFile(preparation.paths.Shadow, []byte("atlas-manager:!:19793:0:99999:7:::\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || passwordCheck(report).Code != "runtime_password_residual" || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
}

func TestInspectExistingIdentityRequiresOneLockedShadowEntry(t *testing.T) {
	tests := []struct {
		name       string
		shadow     string
		wantStatus qualificationreport.Status
		wantCode   string
	}{
		{name: "missing", shadow: "", wantStatus: qualificationreport.Blocked, wantCode: "runtime_password_missing"},
		{name: "unlocked", shadow: "atlas-manager:$6$hash:19793:0:99999:7:::\n", wantStatus: qualificationreport.Blocked, wantCode: "runtime_password_unlocked"},
		{name: "duplicate", shadow: "atlas-manager:!:19793:0:99999:7:::\natlas-manager:*:19793:0:99999:7:::\n", wantStatus: qualificationreport.Blocked, wantCode: "runtime_password_duplicate"},
		{name: "bang_locked", shadow: "atlas-manager:!:19793:0:99999:7:::\n", wantStatus: qualificationreport.Passed, wantCode: "runtime_password_locked"},
		{name: "star_locked", shadow: "atlas-manager:*:19793:0:99999:7:::\n", wantStatus: qualificationreport.Passed, wantCode: "runtime_password_locked"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			preparation := testPreparation(t, "preparation_required", &fakeAccountExecutor{})
			writeExistingIdentity(t, preparation, test.shadow)
			report, err := preparation.Run(context.Background(), Inspect, "")
			if err != nil {
				t.Fatal(err)
			}
			check := passwordCheck(report)
			if check.Status != test.wantStatus || check.Code != test.wantCode {
				t.Fatalf("password check=%+v report=%+v", check, report)
			}
		})
	}
}

func TestInspectPasswordStateBlocksUnsafeShadowMetadataAndReadFailure(t *testing.T) {
	preparation := testPreparation(t, "preparation_required", &fakeAccountExecutor{})
	writeExistingIdentity(t, preparation, "atlas-manager:!:19793:0:99999:7:::\n")
	preparation.deps.ValidateAccountFile = func(path string) error {
		if path == preparation.paths.Shadow {
			return os.ErrPermission
		}
		return nil
	}
	report, err := preparation.Run(context.Background(), Inspect, "")
	if err != nil || passwordCheck(report).Status != qualificationreport.Blocked || passwordCheck(report).Code != "account_database_unsafe" {
		t.Fatalf("unsafe metadata report=%+v err=%v", report, err)
	}

	preparation = testPreparation(t, "preparation_required", &fakeAccountExecutor{})
	writeExistingIdentity(t, preparation, "atlas-manager:!:19793:0:99999:7:::\n")
	originalRead := preparation.deps.ReadFile
	preparation.deps.ReadFile = func(path string) ([]byte, error) {
		if path == preparation.paths.Shadow {
			return nil, os.ErrPermission
		}
		return originalRead(path)
	}
	report, err = preparation.Run(context.Background(), Inspect, "")
	if err != nil || passwordCheck(report).Status != qualificationreport.Blocked || passwordCheck(report).Code != "account_database_unsafe" {
		t.Fatalf("read failure report=%+v err=%v", report, err)
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
	if err != nil || report.Result != "preparation_failed_rolled_back" || report.Transaction.Code != "runtime_user_creation_failed_rolled_back" {
		t.Fatalf("report=%+v err=%v commands=%v group=%q passwd=%q", report, err, executor.seen, executor.group, executor.passwd)
	}
	for _, check := range report.Checks {
		if check.Name == "preparation_lock" && check.Code == "preparation_lock_conflict" {
			t.Fatal("operation reported its own preparation lock as an external conflict")
		}
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
	for _, path := range []string{preparation.paths.StateFile, preparation.paths.StateFile + ".candidate", preparation.paths.Journal + ".candidate", preparation.paths.Lock, preparation.paths.RuntimeHome, preparation.paths.MailSpoolPaths[0], preparation.paths.MailSpoolPaths[1]} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("rollback residue at %s: %v", path, err)
		}
	}
}

func TestPrepareDisabledUsesUbuntuCapabilitySetWithoutNoLogInit(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	for _, command := range executor.seen {
		if strings.Contains(command, "--no-log-init") || strings.Contains(command, "--key") {
			t.Fatalf("unsafe legacy argument used: %s", command)
		}
	}
}

func TestPrepareDisabledUsesEffectiveLogInitNoWithoutOptionalFlag(t *testing.T) {
	executor := &fakeAccountExecutor{defaults: "GROUPS=\nCREATE_MAIL_SPOOL=no\nLOG_INIT=no\n"}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	for _, command := range executor.seen {
		if strings.HasPrefix(command, identitycommand.UserTool) && strings.Contains(command, "--no-log-init") {
			t.Fatalf("unsupported optional flag used: %s", command)
		}
	}
}

func TestPrepareDisabledIncludesNoLogInitOnlyWhenProbed(t *testing.T) {
	executor := &fakeAccountExecutor{help: "--system --no-create-home --no-user-group --gid --home-dir --shell --no-log-init"}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	for _, command := range executor.seen {
		if strings.HasPrefix(command, identitycommand.UserTool) && !strings.Contains(command, "--no-log-init") {
			t.Fatalf("probed optional flag was not used: %s", command)
		}
	}
}

func TestPrepareDisabledExistingLastlogBaselineIsPreserved(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.MkdirAll(filepath.Dir(preparation.paths.LoginLogPaths[0]), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.LoginLogPaths[0], nil, 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(preparation.paths.LoginLogPaths[0])
	if err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" || report.Checks[len(report.Checks)-1].Code != "login_logs_backend_proven_safe" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	after, err := os.ReadFile(preparation.paths.LoginLogPaths[0])
	if err != nil || string(after) != string(before) {
		t.Fatalf("lastlog changed: before=%q after=%q err=%v", before, after, err)
	}
}

func TestPrepareDisabledUbuntu26FixturePassesReadinessContract(t *testing.T) {
	executor := &fakeAccountExecutor{defaults: "GROUPS=\nCREATE_MAIL_SPOOL=no\n"}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.MkdirAll(filepath.Dir(preparation.paths.LoginLogPaths[0]), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.LoginLogPaths[0], nil, 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
}

func TestPrepareDisabledAcceptsExistingLastlogWhenLastlogBackendIsNotBuilt(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.MkdirAll(filepath.Dir(preparation.paths.LoginLogPaths[0]), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.LoginLogPaths[0], []byte("existing"), 0o600); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(preparation.paths.LoginLogPaths[0])
	if err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "prepared" || report.Checks[len(report.Checks)-1].Code != "login_logs_backend_proven_safe" {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
	after, err := os.ReadFile(preparation.paths.LoginLogPaths[0])
	if err != nil || string(after) != string(before) {
		t.Fatalf("lastlog changed: before=%q after=%q err=%v", before, after, err)
	}
}

func trustedLoginLogFixture(t *testing.T, target string) (string, string, string) {
	t.Helper()
	root := t.TempDir()
	logDir := filepath.Join(root, "var/log")
	usrSbin := filepath.Join(root, "usr/sbin")
	if err := os.MkdirAll(logDir, 0o775); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(usrSbin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(logDir, 0o775); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(filepath.Join(root, "var"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(root, "sbin")); err != nil {
		t.Fatal(err)
	}
	lastlog := filepath.Join(logDir, "lastlog")
	if err := os.WriteFile(lastlog, nil, 0o664); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(lastlog, 0o664); err != nil {
		t.Fatal(err)
	}
	return root, logDir, lastlog
}

func TestTrustedUbuntuLoginLogLayoutIsAccepted(t *testing.T) {
	root, logDir, lastlog := trustedLoginLogFixture(t, "usr/sbin")
	preparation := Preparation{paths: Paths{
		Usr: root + "/usr", UsrSbin: root + "/usr/sbin", PamTally2: root + "/sbin/pam_tally2",
		LoginLogPaths: []string{lastlog, logDir + "/faillog", logDir + "/tallylog"},
	}}
	baseline, ok := preparation.captureLoginLogBaseline()
	if !ok || len(baseline.Layout) != 5 || !preparation.baselineMatches(baseline) {
		t.Fatalf("trusted layout rejected: ok=%v baseline=%+v", ok, baseline)
	}
}

func TestTrustedMergedUsrAbsoluteTargetIsAccepted(t *testing.T) {
	for _, target := range []string{"usr/sbin", "/usr/sbin"} {
		if !canonicalMergedUsrTarget(target) {
			t.Fatalf("canonical target rejected: %q", target)
		}
	}
}

func TestUnsafeLoginLogLayoutIsRejected(t *testing.T) {
	cases := []struct {
		name  string
		setup func(string, string)
	}{
		{name: "world writable log directory", setup: func(_ string, logDir string) { _ = os.Chmod(logDir, 0o777) }},
		{name: "log directory symlink", setup: func(root, logDir string) {
			_ = os.RemoveAll(logDir)
			_ = os.Symlink("/tmp", logDir)
		}},
		{name: "lastlog world writable", setup: func(_ string, logDir string) {
			_ = os.Chmod(filepath.Join(logDir, "lastlog"), 0o666)
		}},
		{name: "lastlog directory", setup: func(_ string, logDir string) {
			_ = os.Remove(filepath.Join(logDir, "lastlog"))
			_ = os.Mkdir(filepath.Join(logDir, "lastlog"), 0o664)
		}},
		{name: "lastlog oversized", setup: func(_ string, logDir string) {
			_ = os.Truncate(filepath.Join(logDir, "lastlog"), maxLoginLogBaselineSize+1)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root, logDir, lastlog := trustedLoginLogFixture(t, "usr/sbin")
			tc.setup(root, logDir)
			preparation := Preparation{paths: Paths{
				Usr: root + "/usr", UsrSbin: root + "/usr/sbin", PamTally2: root + "/sbin/pam_tally2",
				LoginLogPaths: []string{lastlog, logDir + "/faillog", logDir + "/tallylog"},
			}}
			if _, ok := preparation.captureLoginLogBaseline(); ok {
				t.Fatal("unsafe layout accepted")
			}
		})
	}
}

func TestMergedUsrRejectsUnexpectedTargetsAndWritableResolvedDirectories(t *testing.T) {
	cases := []string{"/tmp/sbin", "../../tmp/sbin", "usr/other"}
	for _, target := range cases {
		t.Run(target, func(t *testing.T) {
			root, logDir, lastlog := trustedLoginLogFixture(t, target)
			preparation := Preparation{paths: Paths{
				Usr: root + "/usr", UsrSbin: root + "/usr/sbin", PamTally2: root + "/sbin/pam_tally2",
				LoginLogPaths: []string{lastlog, logDir + "/faillog", logDir + "/tallylog"},
			}}
			if _, ok := preparation.captureLoginLogBaseline(); ok {
				t.Fatal("unexpected merged-usr target accepted")
			}
		})
	}
	root, logDir, lastlog := trustedLoginLogFixture(t, "usr/sbin")
	if err := os.Chmod(root+"/usr/sbin", 0o775); err != nil {
		t.Fatal(err)
	}
	preparation := Preparation{paths: Paths{
		Usr: root + "/usr", UsrSbin: root + "/usr/sbin", PamTally2: root + "/sbin/pam_tally2",
		LoginLogPaths: []string{lastlog, logDir + "/faillog", logDir + "/tallylog"},
	}}
	if _, ok := preparation.captureLoginLogBaseline(); ok {
		t.Fatal("writable resolved directory accepted")
	}
}

func TestAbsentLoginLogLeavesAndPamTallyAreAccepted(t *testing.T) {
	root, logDir, lastlog := trustedLoginLogFixture(t, "usr/sbin")
	preparation := Preparation{paths: Paths{
		Usr: root + "/usr", UsrSbin: root + "/usr/sbin", PamTally2: root + "/sbin/pam_tally2",
		LoginLogPaths: []string{lastlog, logDir + "/faillog", logDir + "/tallylog"},
	}}
	if _, ok := preparation.captureLoginLogBaseline(); !ok {
		t.Fatal("absent optional login-log leaves rejected")
	}
}

func TestPrepareDisabledExistingFaillogStateBlocksBeforeMutation(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.MkdirAll(filepath.Dir(preparation.paths.LoginLogPaths[1]), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.LoginLogPaths[1], []byte("faillog record"), 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || report.Transaction.Code != "login_log_strategy_unsupported" || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
}

func TestPrepareDisabledUnprovenAccountToolPackageBlocksBeforeMutation(t *testing.T) {
	executor := &fakeAccountExecutor{packageResult: identitycommand.Result{Stdout: []byte("passwd\n1:4.17.4-2ubuntu4\nshadow\n1:4.17.4-2ubuntu4\namd64\n")}}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || report.Transaction.Code != "login_log_strategy_unsupported" || executor.packageCalls != 1 || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v packageCalls=%d commands=%v", report, err, executor.packageCalls, executor.seen)
	}
}

func TestPrepareDisabledPamTallyExecutableBlocksBeforeMutation(t *testing.T) {
	executor := &fakeAccountExecutor{}
	preparation := testPreparation(t, "preparation_required", executor)
	preparation.paths.PamTally2 = filepath.Join(filepath.Dir(preparation.paths.LoginLogPaths[0]), "pam_tally2")
	if err := os.MkdirAll(filepath.Dir(preparation.paths.PamTally2), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.PamTally2, []byte("fixture"), 0o700); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || report.Transaction.Code != "login_log_strategy_unsupported" || executor.packageCalls != 0 || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
}

func TestPrepareDisabledChangedLoginLogRequiresRecovery(t *testing.T) {
	executor := &fakeAccountExecutor{mutateLoginLog: true}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.MkdirAll(filepath.Dir(preparation.paths.LoginLogPaths[0]), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.LoginLogPaths[0], nil, 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "preparation_failed_recovery_required" || report.Transaction.Code != "login_log_artifact_changed_recovery_required" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := os.Stat(preparation.paths.LoginLogPaths[0]); err != nil {
		t.Fatalf("preexisting login log was removed: %v", err)
	}
}

func TestPrepareDisabledRollbackPreservesPreexistingLoginLog(t *testing.T) {
	executor := &fakeAccountExecutor{failPath: identitycommand.UserTool}
	preparation := testPreparation(t, "preparation_required", executor)
	if err := os.MkdirAll(filepath.Dir(preparation.paths.LoginLogPaths[0]), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(preparation.paths.LoginLogPaths[0], nil, 0o600); err != nil {
		t.Fatal(err)
	}
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "preparation_failed_rolled_back" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := os.Stat(preparation.paths.LoginLogPaths[0]); err != nil {
		t.Fatalf("preexisting login log was deleted: %v", err)
	}
}

func TestPrepareDisabledBlocksBeforeGroupsWhenCapabilityIsMissing(t *testing.T) {
	executor := &fakeAccountExecutor{help: "--system --no-create-home --no-user-group --gid --home-dir"}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "blocked" || report.Transaction.Code != "account_tool_capability_unsupported" || len(executor.seen) != 0 {
		t.Fatalf("report=%+v err=%v commands=%v", report, err, executor.seen)
	}
}

func TestPrepareDisabledBlocksUnsafeMailSpoolDefaultBeforeGroups(t *testing.T) {
	for _, defaults := range []string{"GROUP=100\n", "CREATE_MAIL_SPOOL=yes\n", "CREATE_MAIL_SPOOL=no\nCREATE_MAIL_SPOOL=no\n", "CREATE_MAIL_SPOOL =no\n"} {
		executor := &fakeAccountExecutor{defaults: defaults}
		preparation := testPreparation(t, "preparation_required", executor)
		report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
		wantCode := "mail_spool_default_unsafe"
		if strings.Contains(defaults, "CREATE_MAIL_SPOOL=no\nCREATE_MAIL_SPOOL=no") || defaults == "CREATE_MAIL_SPOOL =no\n" {
			wantCode = "account_defaults_invalid"
		}
		if err != nil || report.Result != "blocked" || report.Transaction.Code != wantCode || len(executor.seen) != 0 {
			t.Fatalf("defaults=%q report=%+v err=%v commands=%v", defaults, report, err, executor.seen)
		}
	}
}

func TestPrepareDisabledReportsRecoveryWhenRollbackLeavesMailResidue(t *testing.T) {
	executor := &fakeAccountExecutor{failPath: identitycommand.UserTool, mail: true}
	preparation := testPreparation(t, "preparation_required", executor)
	report, err := preparation.Run(context.Background(), PrepareDisabled, Confirmation)
	if err != nil || report.Result != "preparation_failed_recovery_required" || report.Transaction.Code != "runtime_user_creation_failed_recovery_required" {
		t.Fatalf("report=%+v err=%v", report, err)
	}
	if _, err := os.Stat(preparation.paths.Journal); err != nil {
		t.Fatalf("recovery journal missing: %v", err)
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
