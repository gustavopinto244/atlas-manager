package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeconfiguration"
)

func main() {
	if len(os.Args) < 2 || !runtimeconfiguration.ValidAction(os.Args[1]) {
		fail("action_invalid")
	}
	confirmation := ""
	if runtimeconfiguration.Action(os.Args[1]) == runtimeconfiguration.InstallMock || runtimeconfiguration.Action(os.Args[1]) == runtimeconfiguration.RemoveMock {
		if len(os.Args) != 3 {
			fail("confirmation_invalid")
		}
		confirmation = os.Args[2]
	} else if len(os.Args) != 2 {
		fail("arguments_invalid")
	}
	executable, err := os.Executable()
	if err != nil {
		fail("executable_invalid")
	}
	configuration := runtimeconfiguration.New(runtimeconfiguration.ProductionPaths(filepath.Dir(executable)), runtimeconfiguration.Dependencies{EffectiveUID: os.Geteuid, ApplyOwnership: true})
	report, err := configuration.Run(context.Background(), runtimeconfiguration.Action(os.Args[1]), confirmation)
	if err != nil {
		fail(errorCode(err))
	}
	data, err := report.Marshal()
	if err != nil {
		fail("configuration_report_invalid")
	}
	if _, err := os.Stdout.Write(data); err != nil {
		fail("configuration_output_failed")
	}
	if report.Result == "blocked" || report.Result == "interrupted" {
		os.Exit(1)
	}
}

func fail(code string) {
	_, _ = fmt.Fprintln(os.Stderr, "atlas-manager-runtime-configuration: "+code)
	os.Exit(1)
}
func errorCode(err error) string { return err.Error() }
