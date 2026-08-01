//go:build linux

package main

import (
	"os"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/installer"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/qualification"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
)

const (
	invalidInvocationExit = 64
	privilegeExit         = 77
	internalFailureExit   = 70
)

func main() {
	os.Exit(run())
}

func run() (exitCode int) {
	defer func() {
		if recover() != nil {
			exitCode = internalFailureExit
		}
	}()
	if len(os.Args) != 2 || !qualification.ValidAction(os.Args[1]) {
		return invalidInvocationExit
	}
	if os.Geteuid() != 0 {
		return privilegeExit
	}
	bundleRoot, err := installer.DiscoverBundleRoot()
	if err != nil {
		return internalFailureExit
	}
	dependencies := qualification.Dependencies{
		Platform:     qualification.LinuxPlatform{},
		FileSystem:   qualification.LinuxFileSystem{},
		Clock:        rtc.SystemClock{},
		Installation: qualification.NewManagedInstallation(bundleRoot),
		Logind:       qualification.NewFixedLogindInspector(),
	}
	report, err := qualification.New(dependencies).Run(os.Args[1])
	if err != nil {
		return internalFailureExit
	}
	encoded, err := report.MarshalCanonical()
	if err != nil {
		return internalFailureExit
	}
	if _, err := os.Stdout.Write(encoded); err != nil {
		return internalFailureExit
	}
	return 0
}
