package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/atlas-manager/atlas-manager/deployment/internal/serverinstallation"
)

func main() {
	if len(os.Args) != 2 || !serverinstallation.ValidAction(os.Args[1]) {
		fail("action_invalid")
	}
	executable, err := serverinstallation.ExecutablePath()
	if err != nil {
		fail(err.Error())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	report := serverinstallation.New(serverinstallation.SiblingPaths(executable), nil).Run(ctx, serverinstallation.Action(os.Args[1]))
	data, err := report.Marshal()
	if err != nil {
		fail(err.Error())
	}
	if _, err := os.Stdout.Write(data); err != nil {
		fail("report_write_failed")
	}
	if report.Result == "blocked" {
		os.Exit(1)
	}
}

func fail(code string) {
	_, _ = fmt.Fprintln(os.Stderr, "atlas-manager-server-installer: "+code)
	os.Exit(1)
}
