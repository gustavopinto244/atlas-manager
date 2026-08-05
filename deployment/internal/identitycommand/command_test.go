package identitycommand

import (
	"context"
	"strings"
	"testing"
)

type recordingExecutor struct {
	path string
	args []string
}

func (executor *recordingExecutor) Run(_ context.Context, path string, args []string) Result {
	executor.path = path
	executor.args = append([]string(nil), args...)
	return Result{}
}

func TestFixedAccountCommandArguments(t *testing.T) {
	tests := []struct {
		name string
		path string
		args []string
		want []string
	}{
		{"primary group", PrimaryGroupTool, PrimaryGroupArguments(), []string{"--system", "atlas-manager"}},
		{"helper group", HelperGroupTool, HelperGroupArguments(), []string{"--system", "atlas-manager-power"}},
		{"runtime user", UserTool, UserArguments(UserAddCapabilities{System: true, NoCreateHome: true, NoUserGroup: true, GID: true, HomeDir: true, Shell: true, NoLogInit: true}), []string{"--system", "--no-create-home", "--no-user-group", "--no-log-init", "--gid", "atlas-manager", "--home-dir", "/var/lib/atlas-manager", "--shell", "/usr/sbin/nologin", "atlas-manager"}},
		{"user rollback", UserDeleteTool, UserDeleteArguments(), []string{"atlas-manager"}},
		{"helper rollback", GroupDeleteTool, HelperGroupDeleteArguments(), []string{"atlas-manager-power"}},
		{"primary rollback", GroupDeleteTool, PrimaryGroupDeleteArguments(), []string{"atlas-manager"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			executor := &recordingExecutor{}
			if result := executor.Run(context.Background(), test.path, test.args); result.ExitCode != 0 {
				t.Fatal("recording executor failed")
			}
			if executor.path != test.path || len(executor.args) != len(test.want) {
				t.Fatalf("command = %q %q, want %q %q", executor.path, executor.args, test.path, test.want)
			}
			for index := range test.want {
				if executor.args[index] != test.want[index] {
					t.Fatalf("argument %d = %q, want %q", index, executor.args[index], test.want[index])
				}
			}
		})
	}
}

func TestProbeUserAddCapabilitiesAndMailDefaults(t *testing.T) {
	executor := &recordingOutputExecutor{
		help:     "--system --no-create-home --no-user-group --gid --home-dir --shell --no-log-init",
		defaults: "CREATE_MAIL_SPOOL=no\n",
	}
	capabilities, err := ProbeUserAdd(context.Background(), executor)
	if err != nil || !capabilities.NoLogInit || executor.calls != 1 {
		t.Fatalf("capabilities=%+v err=%v calls=%d", capabilities, err, executor.calls)
	}
	defaults, err := ProbeUserAddDefaults(context.Background(), executor)
	if err != nil || defaults.CreateMailSpool != "no" || defaults.LogInit != "" || executor.calls != 2 {
		t.Fatalf("mail default err=%v calls=%d", err, executor.calls)
	}
}

func TestProbeAccountToolPackageAcceptsProvenUbuntuPackage(t *testing.T) {
	executor := &recordingOutputExecutor{packageOutput: provenPackageOutput()}
	value, err := ProbeAccountToolPackage(context.Background(), executor)
	if err != nil || value != ProvenAccountToolPackage() || executor.packageCalls != 1 {
		t.Fatalf("package=%+v err=%v packageCalls=%d", value, err, executor.packageCalls)
	}
	if executor.packagePath != DpkgQueryTool || !equalStrings(executor.packageArgs, AccountToolPackageArguments()) {
		t.Fatalf("command=%q %q", executor.packagePath, executor.packageArgs)
	}
}

func TestProbeAccountToolPackageRejectsUnprovenOutput(t *testing.T) {
	proven := strings.Split(provenPackageOutput(), "\n")
	tests := []struct {
		name   string
		result Result
	}{
		{name: "binary version", result: Result{Stdout: []byte(strings.Join([]string{proven[0], "1:4.17.4-2ubuntu4", proven[2], proven[3], proven[4], ""}, "\n"))}},
		{name: "source version", result: Result{Stdout: []byte(strings.Join([]string{proven[0], proven[1], proven[2], "1:4.17.4-2ubuntu4", proven[4], ""}, "\n"))}},
		{name: "binary package", result: Result{Stdout: []byte(strings.Join([]string{"login", proven[1], proven[2], proven[3], proven[4], ""}, "\n"))}},
		{name: "source package", result: Result{Stdout: []byte(strings.Join([]string{proven[0], proven[1], "shadow-common", proven[3], proven[4], ""}, "\n"))}},
		{name: "architecture", result: Result{Stdout: []byte(strings.Join([]string{proven[0], proven[1], proven[2], proven[3], "arm64", ""}, "\n"))}},
		{name: "stderr", result: Result{Stdout: []byte(provenPackageOutput()), Stderr: []byte("warning\n")}},
		{name: "invalid utf8", result: Result{Stdout: []byte{0xff, 0xfe}}},
		{name: "wrong line count", result: Result{Stdout: []byte("passwd\n1:4.17.4-2ubuntu3\n")}},
		{name: "nonzero exit", result: Result{ExitCode: 1, Stdout: []byte(provenPackageOutput())}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			executor := &recordingOutputExecutor{packageResult: test.result}
			if _, err := ProbeAccountToolPackage(context.Background(), executor); err == nil || err.Error() != "account_tool_package_unsupported" {
				t.Fatalf("err=%v", err)
			}
		})
	}
}

func TestProbeReadinessOnlyQueriesPackageForFallback(t *testing.T) {
	baseHelp := "--system --no-create-home --no-user-group --gid --home-dir --shell"
	for _, test := range []struct {
		name       string
		help       string
		defaults   string
		packageHit int
	}{
		{name: "no log init option", help: baseHelp + " --no-log-init", defaults: "CREATE_MAIL_SPOOL=no\nLOG_INIT=yes\n", packageHit: 0},
		{name: "log init no", help: baseHelp, defaults: "CREATE_MAIL_SPOOL=no\nLOG_INIT=no\n", packageHit: 0},
		{name: "fallback", help: baseHelp, defaults: "CREATE_MAIL_SPOOL=no\nLOG_INIT=yes\n", packageHit: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			executor := &recordingOutputExecutor{help: test.help, defaults: test.defaults, packageOutput: provenPackageOutput()}
			readiness, err := ProbeReadiness(context.Background(), executor)
			if err != nil || executor.packageCalls != test.packageHit {
				t.Fatalf("readiness=%+v err=%v packageCalls=%d", readiness, err, executor.packageCalls)
			}
		})
	}
}

func TestParseUbuntuDefaultsAndPermissiveUnrelatedFields(t *testing.T) {
	for _, output := range []string{
		"GROUPS=\nUSRSKEL=/usr/etc/skel\nCREATE_MAIL_SPOOL=no\nLOG_INIT=yes\n",
		"UNKNOWN=value\nCREATE_MAIL_SPOOL=no\n",
		"GROUPS=\nCREATE_MAIL_SPOOL=no\n",
	} {
		executor := &recordingOutputExecutor{defaults: output}
		defaults, err := ProbeUserAddDefaults(context.Background(), executor)
		if err != nil || defaults.Values["GROUPS"] != "" || defaults.CreateMailSpool != "no" {
			t.Fatalf("output=%q defaults=%+v err=%v", output, defaults, err)
		}
	}
}

func TestProbeUserAddRejectsMissingRequiredCapability(t *testing.T) {
	executor := &recordingOutputExecutor{help: "--system --no-create-home --no-user-group --gid --home-dir"}
	if _, err := ProbeUserAdd(context.Background(), executor); err == nil {
		t.Fatal("missing required shell capability accepted")
	}
}

func TestValidateMailSpoolDefaultRejectsUnsafeOutput(t *testing.T) {
	for _, test := range []struct{ output, code string }{
		{"", "mail_spool_default_unsafe"},
		{"CREATE_MAIL_SPOOL=yes\n", "mail_spool_default_unsafe"},
		{"CREATE_MAIL_SPOOL=no\nCREATE_MAIL_SPOOL=no\n", "account_defaults_invalid"},
		{"CREATE_MAIL_SPOOL =no\n", "account_defaults_invalid"},
		{"create_mail_spool=no\n", "account_defaults_invalid"},
		{string([]byte{0xff, 0xfe}), "account_defaults_invalid"},
	} {
		executor := &recordingOutputExecutor{defaults: test.output}
		if err := ValidateMailSpoolDefault(context.Background(), executor); err == nil || err.Error() != test.code {
			t.Fatalf("defaults=%q err=%v want=%s", test.output, err, test.code)
		}
	}
}

func TestDefaultsDoNotCombineStdoutAndStderr(t *testing.T) {
	executor := &recordingOutputExecutor{defaults: "CREATE_MAIL_SPOOL=no\n", defaultsErr: "LOG_INIT=yes\n"}
	if _, err := ProbeUserAddDefaults(context.Background(), executor); err == nil {
		t.Fatal("stderr was accepted as configuration output")
	}
}

func TestValidateMailSpoolDefaultRejectsOversizedOutput(t *testing.T) {
	executor := &recordingOutputExecutor{defaults: strings.Repeat("A", OutputLimit+1)}
	if err := ValidateMailSpoolDefault(context.Background(), executor); err == nil {
		t.Fatal("oversized defaults accepted")
	}
}

type recordingOutputExecutor struct {
	help          string
	defaults      string
	defaultsErr   string
	packageOutput string
	packageResult Result
	packageCalls  int
	packagePath   string
	packageArgs   []string
	calls         int
}

func (executor *recordingOutputExecutor) Run(_ context.Context, path string, args []string) Result {
	executor.calls++
	if len(args) == 3 && args[0] == "-W" {
		executor.packageCalls++
		executor.packagePath = path
		executor.packageArgs = append([]string(nil), args...)
		if executor.packageResult.ExitCode != 0 || executor.packageResult.Stdout != nil || executor.packageResult.Stderr != nil {
			return executor.packageResult
		}
		return Result{Stdout: []byte(executor.packageOutput)}
	}
	if len(args) == 1 && args[0] == "--help" {
		return Result{Stdout: []byte(executor.help)}
	}
	return Result{Stdout: []byte(executor.defaults), Stderr: []byte(executor.defaultsErr)}
}

func provenPackageOutput() string {
	return "passwd\n1:4.17.4-2ubuntu3\nshadow\n1:4.17.4-2ubuntu3\namd64\n"
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
