package runtime

import (
	"io"
	"os"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/backend"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/lock"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/privilege"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
)

func Run(stdin io.Reader, stdout io.Writer, startup privilege.StartupDependencies, operations backend.Operations) int {
	if !privilege.ValidateStartup(startup) {
		return protocol.InternalFailureExitCode
	}
	input, err := readBounded(stdin)
	if err != nil {
		return protocol.InvalidInputExitCode
	}
	request, err := protocol.ParseRequestLine(input)
	if err != nil {
		return protocol.InvalidInputExitCode
	}
	response, err := protocol.MarshalResponse(backend.Dispatch(operations, request))
	if err != nil {
		return protocol.InternalFailureExitCode
	}
	if _, err = stdout.Write(response); err != nil {
		return protocol.InternalFailureExitCode
	}
	return 0
}

func readBounded(reader io.Reader) ([]byte, error) {
	input, err := io.ReadAll(io.LimitReader(reader, protocol.MaxRequestBytes+1))
	if err != nil || len(input) > protocol.MaxRequestBytes {
		return nil, protocol.ErrInvalidInput
	}
	return input, nil
}

func RunProcess() (exitCode int) {
	defer func() {
		if recover() != nil {
			exitCode = protocol.InternalFailureExitCode
		}
	}()
	startup := privilege.CurrentStartupDependencies(len(os.Args))
	fileSystem := rtc.LinuxFileSystem{}
	clock := rtc.SystemClock{}
	reader := rtc.NewReader(fileSystem, clock)
	mutator := rtc.NewMutator(fileSystem, clock)
	operations := backend.NewLinuxOperations(reader, mutator, lock.NewFixedFileLock())
	return Run(os.Stdin, os.Stdout, startup, operations)
}
