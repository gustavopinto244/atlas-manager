//go:build linux

package main

import (
	"fmt"
	"os"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/installer"
)

func main() {
	if len(os.Args) != 2 {
		os.Exit(64)
	}
	root, err := installer.DiscoverBundleRoot()
	if err != nil {
		fmt.Fprintln(os.Stdout, installer.FormatStatus(installer.StatusBundleInvalid))
		os.Exit(70)
	}
	status, runErr := installer.NewProduction(root).Run(os.Args[1])
	if runErr != nil {
		status = installer.SafeStatus(runErr)
	}
	fmt.Fprintln(os.Stdout, installer.FormatStatus(status))
	if runErr != nil {
		os.Exit(70)
	}
}
