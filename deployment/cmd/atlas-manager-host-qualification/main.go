package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atlas-manager/atlas-manager/deployment/internal/hostinspection"
	"github.com/atlas-manager/atlas-manager/deployment/internal/qualification"
)

func main() {
	if len(os.Args) != 2 || !qualification.ValidAction(os.Args[1]) {
		fail("action_invalid")
	}
	executable, err := os.Executable()
	if err != nil {
		fail("executable_invalid")
	}
	inspector := hostinspection.New(hostinspection.ProductionPaths(filepath.Dir(executable)), hostinspection.Dependencies{EffectiveUID: os.Geteuid, EnforceOwner: true})
	report, err := qualification.Run(context.Background(), qualification.Action(os.Args[1]), inspector)
	if err != nil {
		fail("qualification_failed")
	}
	data, err := report.Marshal()
	if err != nil {
		fail("qualification_report_invalid")
	}
	if _, err := os.Stdout.Write(data); err != nil {
		fail("qualification_output_failed")
	}
	if report.Result == "blocked" {
		os.Exit(1)
	}
}

func fail(code string) {
	_, _ = fmt.Fprintln(os.Stderr, "atlas-manager-host-qualification: "+code)
	os.Exit(1)
}
