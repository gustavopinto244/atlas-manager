package main

import (
	"os"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/privilege"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/runtime"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/testfixture"
)

func main() {
	startup := privilege.StartupDependencies{
		GOOS:          "linux",
		EffectiveUID:  0,
		Executable:    privilege.ProductionExecutablePath,
		ArgumentCount: 1,
	}
	os.Exit(runtime.Run(os.Stdin, os.Stdout, startup, testfixture.NewOperations()))
}
