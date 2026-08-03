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
	if err := ValidateMailSpoolDefault(context.Background(), executor); err != nil || executor.calls != 2 {
		t.Fatalf("mail default err=%v calls=%d", err, executor.calls)
	}
}

func TestProbeUserAddRejectsMissingRequiredCapability(t *testing.T) {
	executor := &recordingOutputExecutor{help: "--system --no-create-home --no-user-group --gid --home-dir"}
	if _, err := ProbeUserAdd(context.Background(), executor); err == nil {
		t.Fatal("missing required shell capability accepted")
	}
}

func TestValidateMailSpoolDefaultRejectsUnsafeOutput(t *testing.T) {
	for _, output := range []string{"", "CREATE_MAIL_SPOOL=yes\n", "CREATE_MAIL_SPOOL=no\nCREATE_MAIL_SPOOL=no\n", "CREATE_MAIL_SPOOL =no\n", "UNKNOWN=value\nCREATE_MAIL_SPOOL=no\n", string([]byte{0xff, 0xfe})} {
		executor := &recordingOutputExecutor{defaults: output}
		if err := ValidateMailSpoolDefault(context.Background(), executor); err == nil {
			t.Fatalf("unsafe defaults accepted: %q", output)
		}
	}
}

func TestValidateMailSpoolDefaultRejectsOversizedOutput(t *testing.T) {
	executor := &recordingOutputExecutor{defaults: strings.Repeat("A", OutputLimit+1)}
	if err := ValidateMailSpoolDefault(context.Background(), executor); err == nil {
		t.Fatal("oversized defaults accepted")
	}
}

type recordingOutputExecutor struct {
	help     string
	defaults string
	calls    int
}

func (executor *recordingOutputExecutor) Run(_ context.Context, _ string, args []string) Result {
	executor.calls++
	if len(args) == 1 && args[0] == "--help" {
		return Result{Stdout: []byte(executor.help)}
	}
	return Result{Stdout: []byte(executor.defaults)}
}
