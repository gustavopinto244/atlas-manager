package privilege

import (
	"os"
	"path/filepath"
	"runtime"
)

const ProductionExecutablePath = "/usr/local/libexec/atlas-manager-power-helper"

type StartupDependencies struct {
	GOOS          string
	EffectiveUID  int
	Executable    string
	ArgumentCount int
}

func ValidateStartup(dependencies StartupDependencies) bool {
	return dependencies.GOOS == "linux" &&
		dependencies.ArgumentCount == 1 &&
		dependencies.EffectiveUID == 0 &&
		filepath.Clean(dependencies.Executable) == ProductionExecutablePath
}

func CurrentStartupDependencies(argumentCount int) StartupDependencies {
	executable, err := os.Executable()
	if err != nil {
		executable = ""
	}
	return StartupDependencies{
		GOOS:          runtime.GOOS,
		EffectiveUID:  os.Geteuid(),
		Executable:    executable,
		ArgumentCount: argumentCount,
	}
}
