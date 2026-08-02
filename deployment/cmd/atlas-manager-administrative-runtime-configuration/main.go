package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atlas-manager/atlas-manager/deployment/internal/administrativeconfiguration"
)

func main() {
	if len(os.Args) < 2 || !administrativeconfiguration.ValidAction(os.Args[1]) {
		fail("action_invalid")
	}
	action := administrativeconfiguration.Action(os.Args[1])
	confirmation := ""
	if action == administrativeconfiguration.InstallDisabled || action == administrativeconfiguration.RemoveDisabled || action == administrativeconfiguration.ReplaceDisabled || action == administrativeconfiguration.RollbackDisabled {
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
	configuration := administrativeconfiguration.New(
		administrativeconfiguration.ProductionPaths(filepath.Dir(executable)),
		administrativeconfiguration.Dependencies{EffectiveUID: os.Geteuid, ApplyOwnership: true},
	)
	report, err := configuration.Run(context.Background(), action, confirmation)
	if err != nil {
		fail(err.Error())
	}
	data, err := report.Marshal()
	if err != nil {
		fail("report_invalid")
	}
	if _, err := os.Stdout.Write(data); err != nil {
		fail("report_write_failed")
	}
	if report.Result == "blocked" || report.Result == "interrupted" {
		os.Exit(1)
	}
}

func fail(code string) {
	_, _ = fmt.Fprintln(os.Stderr, "atlas-manager-administrative-runtime-configuration: "+code)
	os.Exit(1)
}
