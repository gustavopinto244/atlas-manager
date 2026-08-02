package identitycommand

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
)

const (
	PrimaryGroupTool = "/usr/sbin/groupadd"
	HelperGroupTool  = "/usr/sbin/groupadd"
	UserTool         = "/usr/sbin/useradd"
	UserDeleteTool   = "/usr/sbin/userdel"
	GroupDeleteTool  = "/usr/sbin/groupdel"
	OutputLimit      = 8 * 1024
	CommandTimeout   = 30 * time.Second
)

type Result struct {
	ExitCode int
}

type Executor interface {
	Run(context.Context, string, []string) Result
}

type OSExecutor struct{}

func (OSExecutor) Run(ctx context.Context, path string, args []string) Result {
	commandContext, cancel := context.WithTimeout(ctx, CommandTimeout)
	defer cancel()
	command := exec.CommandContext(commandContext, path, args...)
	command.Env = []string{"PATH=/usr/sbin:/usr/bin:/bin", "LANG=C", "LC_ALL=C", "TZ=UTC"}
	command.Stdin = strings.NewReader("")
	stdout := &boundedWriter{limit: OutputLimit}
	stderr := &boundedWriter{limit: OutputLimit}
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		return Result{ExitCode: exitCode(err)}
	}
	if stdout.overflow || stderr.overflow {
		return Result{ExitCode: -2}
	}
	return Result{ExitCode: 0}
}

func PrimaryGroupArguments() []string { return []string{"--system", "atlas-manager"} }

func HelperGroupArguments() []string { return []string{"--system", "atlas-manager-power"} }

func UserArguments() []string {
	return []string{"--system", "--no-create-home", "--no-user-group", "--no-log-init", "--gid", "atlas-manager", "--home-dir", "/var/lib/atlas-manager", "--shell", "/usr/sbin/nologin", "--key", "CREATE_MAIL_SPOOL=no", "atlas-manager"}
}

func UserDeleteArguments() []string { return []string{"atlas-manager"} }

func HelperGroupDeleteArguments() []string { return []string{"atlas-manager-power"} }

func PrimaryGroupDeleteArguments() []string { return []string{"atlas-manager"} }

type boundedWriter struct {
	data     []byte
	limit    int
	overflow bool
}

func (writer *boundedWriter) Write(value []byte) (int, error) {
	if len(writer.data)+len(value) > writer.limit {
		writer.overflow = true
		return len(value), nil
	}
	writer.data = append(writer.data, value...)
	return len(value), nil
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return exitError.ExitCode()
	}
	return -1
}
