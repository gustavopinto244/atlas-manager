package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atlas-manager/atlas-manager/deployment/internal/identitypreparation"
)

func main() {
	if len(os.Args) < 2 || !identitypreparation.ValidAction(os.Args[1]) {
		fail("action_invalid")
	}
	action := identitypreparation.Action(os.Args[1])
	confirmation := ""
	if action == identitypreparation.PrepareDisabled {
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
	preparation := identitypreparation.New(identitypreparation.ProductionPaths(filepath.Dir(executable)), identitypreparation.Dependencies{})
	report, runErr := preparation.Run(context.Background(), action, confirmation)
	if runErr != nil {
		fail(runErr.Error())
	}
	data, marshalErr := report.Marshal()
	if marshalErr != nil {
		fail("identity_report_invalid")
	}
	if _, writeErr := os.Stdout.Write(data); writeErr != nil {
		fail("identity_report_write_failed")
	}
	if report.Result == "blocked" || report.Result == "preparation_failed_rolled_back" || report.Result == "preparation_failed_recovery_required" {
		os.Exit(1)
	}
}

func fail(code string) {
	_, _ = fmt.Fprintln(os.Stderr, "atlas-manager-runtime-identity-installer: "+code)
	os.Exit(1)
}
