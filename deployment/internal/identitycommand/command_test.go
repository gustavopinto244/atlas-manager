package identitycommand

import (
	"context"
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
		{"runtime user", UserTool, UserArguments(), []string{"--system", "--no-create-home", "--no-user-group", "--no-log-init", "--gid", "atlas-manager", "--home-dir", "/var/lib/atlas-manager", "--shell", "/usr/sbin/nologin", "--key", "CREATE_MAIL_SPOOL=no", "atlas-manager"}},
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
