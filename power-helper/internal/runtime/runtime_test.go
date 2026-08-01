package runtime

import (
	"bytes"
	"testing"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/backend"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/privilege"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
)

var validStartup = privilege.StartupDependencies{
	GOOS: "linux", EffectiveUID: 0, Executable: privilege.ProductionExecutablePath, ArgumentCount: 1,
}

func TestRunReturnsOneCanonicalDenyAllResponse(t *testing.T) {
	request := []byte("{\"version\":1,\"operation\":\"read_wake_alarm\",\"requestedAt\":\"2026-08-01T12:00:00.000Z\"}\n")
	var output bytes.Buffer
	if code := Run(bytes.NewReader(request), &output, validStartup, backend.DenyAll{}); code != 0 {
		t.Fatalf("unexpected exit code: %d", code)
	}
	want := "{\"version\":1,\"operation\":\"read_wake_alarm\",\"outcome\":\"rejected\",\"code\":\"operation_unsupported\"}\n"
	if output.String() != want {
		t.Fatalf("unexpected output: %q", output.String())
	}
}

func TestRunRejectsWithoutOutput(t *testing.T) {
	var output bytes.Buffer
	if code := Run(bytes.NewBufferString("{}\n"), &output, validStartup, backend.DenyAll{}); code != protocol.InvalidInputExitCode {
		t.Fatalf("unexpected exit code: %d", code)
	}
	if output.Len() != 0 {
		t.Fatalf("invalid request produced output: %q", output.String())
	}
	if code := Run(bytes.NewBufferString("{}\n"), &output, privilege.StartupDependencies{GOOS: "linux", EffectiveUID: 0, Executable: privilege.ProductionExecutablePath, ArgumentCount: 2}, backend.DenyAll{}); code != protocol.InternalFailureExitCode {
		t.Fatalf("argument count should fail startup: %d", code)
	}
}
