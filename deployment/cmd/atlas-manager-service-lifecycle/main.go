package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atlas-manager/atlas-manager/deployment/internal/servicelifecycle"
)

func main() {
	if len(os.Args) < 2 || !servicelifecycle.ValidAction(os.Args[1]) {
		fail("action_invalid")
	}
	action := servicelifecycle.Action(os.Args[1])
	confirmation := ""
	if action == servicelifecycle.ActivateMock || action == servicelifecycle.Deactivate {
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
	service := servicelifecycle.New(servicelifecycle.ProductionPaths(filepath.Dir(executable)), servicelifecycle.Dependencies{ApplyOwnership: true})
	report, runErr := service.Run(context.Background(), action, confirmation)
	if runErr != nil {
		fail(runErr.Error())
	}
	data, marshalErr := report.Marshal()
	if marshalErr != nil {
		fail("activation_report_invalid")
	}
	if _, writeErr := os.Stdout.Write(data); writeErr != nil {
		fail("activation_report_write_failed")
	}
	if report.Result == "blocked" || report.Result == "activation_failed_rolled_back" || report.Result == "activation_failed_recovery_required" {
		os.Exit(1)
	}
}

func fail(code string) {
	_, _ = fmt.Fprintln(os.Stderr, "atlas-manager-service-lifecycle: "+code)
	os.Exit(1)
}
