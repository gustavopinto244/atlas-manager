package runtime

import (
	"io"
	"os"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/backend"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/privilege"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
)

func Run(stdin io.Reader, stdout io.Writer, startup privilege.StartupDependencies) int {
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
	response, err := protocol.MarshalResponse(backend.Dispatch(backend.DenyAll{}, request))
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
	return Run(os.Stdin, os.Stdout, startup)
}
