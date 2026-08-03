package identitycommand

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"
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
	Stdout   []byte
	Stderr   []byte
}

type UserAddCapabilities struct {
	System       bool
	NoCreateHome bool
	NoUserGroup  bool
	GID          bool
	HomeDir      bool
	Shell        bool
	NoLogInit    bool
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
		return Result{ExitCode: exitCode(err), Stdout: stdout.data, Stderr: stderr.data}
	}
	if stdout.overflow || stderr.overflow {
		return Result{ExitCode: -2, Stdout: stdout.data, Stderr: stderr.data}
	}
	return Result{ExitCode: 0, Stdout: stdout.data, Stderr: stderr.data}
}

func PrimaryGroupArguments() []string { return []string{"--system", "atlas-manager"} }

func HelperGroupArguments() []string { return []string{"--system", "atlas-manager-power"} }

func UserArguments(capabilities UserAddCapabilities) []string {
	arguments := []string{"--system", "--no-create-home", "--no-user-group"}
	if capabilities.NoLogInit {
		arguments = append(arguments, "--no-log-init")
	}
	arguments = append(arguments, "--gid", "atlas-manager", "--home-dir", "/var/lib/atlas-manager", "--shell", "/usr/sbin/nologin", "atlas-manager")
	return arguments
}

func ProbeUserAdd(ctx context.Context, executor Executor) (UserAddCapabilities, error) {
	result := executor.Run(ctx, UserTool, []string{"--help"})
	if result.ExitCode != 0 || !utf8.Valid(result.Stdout) || !utf8.Valid(result.Stderr) {
		return UserAddCapabilities{}, errors.New("account_tool_capability_unsupported")
	}
	output := string(result.Stdout) + "\n" + string(result.Stderr)
	capabilities := UserAddCapabilities{
		System:       strings.Contains(output, "--system"),
		NoCreateHome: strings.Contains(output, "--no-create-home"),
		NoUserGroup:  strings.Contains(output, "--no-user-group"),
		GID:          strings.Contains(output, "--gid"),
		HomeDir:      strings.Contains(output, "--home-dir"),
		Shell:        strings.Contains(output, "--shell"),
		NoLogInit:    strings.Contains(output, "--no-log-init"),
	}
	if !capabilities.System || !capabilities.NoCreateHome || !capabilities.NoUserGroup || !capabilities.GID || !capabilities.HomeDir || !capabilities.Shell {
		return UserAddCapabilities{}, errors.New("account_tool_capability_unsupported")
	}
	return capabilities, nil
}

func ValidateMailSpoolDefault(ctx context.Context, executor Executor) error {
	result := executor.Run(ctx, UserTool, []string{"-D"})
	if result.ExitCode != 0 || !utf8.Valid(result.Stdout) || !utf8.Valid(result.Stderr) {
		return errors.New("mail_spool_default_unsafe")
	}
	output := string(result.Stdout) + string(result.Stderr)
	count := 0
	seen := map[string]struct{}{}
	allowed := map[string]struct{}{
		"GROUP": {}, "HOME": {}, "INACTIVE": {}, "EXPIRE": {}, "SHELL": {}, "SKEL": {}, "CREATE_MAIL_SPOOL": {},
	}
	for _, line := range strings.Split(output, "\n") {
		if line == "" {
			continue
		}
		parts := strings.Split(line, "=")
		if len(parts) != 2 || parts[0] == "" || strings.TrimSpace(parts[0]) != parts[0] || strings.TrimSpace(parts[1]) != parts[1] {
			return errors.New("mail_spool_default_unsafe")
		}
		if _, ok := allowed[parts[0]]; !ok {
			return errors.New("mail_spool_default_unsafe")
		}
		if _, ok := seen[parts[0]]; ok {
			return errors.New("mail_spool_default_unsafe")
		}
		seen[parts[0]] = struct{}{}
		if parts[0] == "CREATE_MAIL_SPOOL" {
			count++
			if parts[1] != "no" {
				return errors.New("mail_spool_default_unsafe")
			}
		}
	}
	if count != 1 {
		return errors.New("mail_spool_default_unsafe")
	}
	return nil
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
