package identitycommand

import (
	"context"
	"errors"
	"os/exec"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	PrimaryGroupTool = "/usr/sbin/groupadd"
	HelperGroupTool  = "/usr/sbin/groupadd"
	UserTool         = "/usr/sbin/useradd"
	DpkgQueryTool    = "/usr/bin/dpkg-query"
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

type UserAddDefaults struct {
	Values          map[string]string
	CreateMailSpool string
	LogInit         string
}

type AccountToolPackage struct {
	BinaryPackage string
	Version       string
	SourcePackage string
	SourceVersion string
	Architecture  string
}

type Readiness struct {
	Capabilities        UserAddCapabilities
	Defaults            UserAddDefaults
	SuppressionStrategy string
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
	if result.ExitCode != 0 || len(result.Stdout) > OutputLimit || len(result.Stderr) > OutputLimit || !utf8.Valid(result.Stdout) || !utf8.Valid(result.Stderr) {
		return UserAddCapabilities{}, errors.New("account_tool_capability_unsupported")
	}
	capabilities := UserAddCapabilities{
		System:       hasOption(result.Stdout, result.Stderr, "--system"),
		NoCreateHome: hasOption(result.Stdout, result.Stderr, "--no-create-home"),
		NoUserGroup:  hasOption(result.Stdout, result.Stderr, "--no-user-group"),
		GID:          hasOption(result.Stdout, result.Stderr, "--gid"),
		HomeDir:      hasOption(result.Stdout, result.Stderr, "--home-dir"),
		Shell:        hasOption(result.Stdout, result.Stderr, "--shell"),
		NoLogInit:    hasOption(result.Stdout, result.Stderr, "--no-log-init"),
	}
	if !capabilities.System || !capabilities.NoCreateHome || !capabilities.NoUserGroup || !capabilities.GID || !capabilities.HomeDir || !capabilities.Shell {
		return UserAddCapabilities{}, errors.New("account_tool_capability_unsupported")
	}
	return capabilities, nil
}

func ProbeReadiness(ctx context.Context, executor Executor) (Readiness, error) {
	capabilities, err := ProbeUserAdd(ctx, executor)
	if err != nil {
		return Readiness{}, err
	}
	defaults, err := ProbeUserAddDefaults(ctx, executor)
	if err != nil {
		return Readiness{}, err
	}
	return Readiness{Capabilities: capabilities, Defaults: defaults}, nil
}

func ProvenAccountToolPackage() AccountToolPackage {
	return AccountToolPackage{
		BinaryPackage: "passwd",
		Version:       "1:4.17.4-2ubuntu3",
		SourcePackage: "shadow",
		SourceVersion: "1:4.17.4-2ubuntu3",
		Architecture:  "amd64",
	}
}

func AccountToolPackageArguments() []string {
	return []string{"-W", "-f=${binary:Package}\n${Version}\n${source:Package}\n${source:Version}\n${Architecture}\n", "passwd"}
}

func ProbeAccountToolPackage(ctx context.Context, executor Executor) (AccountToolPackage, error) {
	result := executor.Run(ctx, DpkgQueryTool, AccountToolPackageArguments())
	if result.ExitCode != 0 || len(result.Stdout) > OutputLimit || len(result.Stderr) != 0 || !utf8.Valid(result.Stdout) || !utf8.Valid(result.Stderr) {
		return AccountToolPackage{}, errors.New("account_tool_package_unsupported")
	}
	lines := strings.Split(string(result.Stdout), "\n")
	if len(lines) != 6 || lines[5] != "" {
		return AccountToolPackage{}, errors.New("account_tool_package_unsupported")
	}
	for _, line := range lines[:5] {
		if line == "" {
			return AccountToolPackage{}, errors.New("account_tool_package_unsupported")
		}
	}
	accountToolPackage := AccountToolPackage{
		BinaryPackage: lines[0],
		Version:       lines[1],
		SourcePackage: lines[2],
		SourceVersion: lines[3],
		Architecture:  lines[4],
	}
	if accountToolPackage != ProvenAccountToolPackage() {
		return AccountToolPackage{}, errors.New("account_tool_package_unsupported")
	}
	return accountToolPackage, nil
}

func ValidateMailSpoolDefault(ctx context.Context, executor Executor) error {
	_, err := ProbeUserAddDefaults(ctx, executor)
	return err
}

func ProbeUserAddDefaults(ctx context.Context, executor Executor) (UserAddDefaults, error) {
	result := executor.Run(ctx, UserTool, []string{"-D"})
	if result.ExitCode != 0 || len(result.Stdout) > OutputLimit || len(result.Stderr) > OutputLimit || !utf8.Valid(result.Stdout) || !utf8.Valid(result.Stderr) || strings.TrimSpace(string(result.Stderr)) != "" {
		return UserAddDefaults{}, errors.New("account_defaults_invalid")
	}
	values := map[string]string{}
	for _, line := range strings.Split(string(result.Stdout), "\n") {
		if line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok || !canonicalKey.MatchString(key) || strings.TrimSpace(key) != key || strings.TrimSpace(value) != value {
			return UserAddDefaults{}, errors.New("account_defaults_invalid")
		}
		if _, exists := values[key]; exists {
			return UserAddDefaults{}, errors.New("account_defaults_invalid")
		}
		values[key] = value
	}
	mailSpool, ok := values["CREATE_MAIL_SPOOL"]
	if !ok || mailSpool != "no" {
		return UserAddDefaults{}, errors.New("mail_spool_default_unsafe")
	}
	logInit := ""
	if value, present := values["LOG_INIT"]; present {
		if value != "yes" && value != "no" {
			return UserAddDefaults{}, errors.New("account_defaults_invalid")
		}
		logInit = value
	}
	return UserAddDefaults{Values: values, CreateMailSpool: mailSpool, LogInit: logInit}, nil
}

var canonicalKey = regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`)

func hasOption(stdout, stderr []byte, option string) bool {
	for _, data := range [][]byte{stdout, stderr} {
		for _, field := range strings.Fields(string(data)) {
			if field == option || strings.HasPrefix(field, option+"=") || strings.HasPrefix(field, option+",") {
				return true
			}
		}
	}
	return false
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
