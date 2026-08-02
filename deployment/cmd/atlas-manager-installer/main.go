package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atlas-manager/atlas-manager/deployment/internal/installer"
)

func main() {
	if len(os.Args) != 2 {
		fail("action_invalid")
	}
	action := installer.Action(os.Args[1])
	executable, err := os.Executable()
	if err != nil {
		fail("executable_invalid")
	}
	if err := installer.New(installer.Config{BundleRoot: filepath.Dir(executable), Paths: installer.ProductionPaths(), ApplyOwnership: true}).Run(context.Background(), action); err != nil {
		fail(err.Error())
	}
}

func fail(code string) { fmt.Fprintln(os.Stderr, "atlas-manager-installer: "+code); os.Exit(1) }
