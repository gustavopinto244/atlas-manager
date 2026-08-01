package privilege

import "testing"

func TestStartupRequiresLinuxRootFixedIdentityAndNoArguments(t *testing.T) {
	valid := StartupDependencies{
		GOOS: "linux", EffectiveUID: 0, Executable: ProductionExecutablePath, ArgumentCount: 1,
	}
	if !ValidateStartup(valid) {
		t.Fatal("valid startup was rejected")
	}
	for name, invalid := range map[string]StartupDependencies{
		"non-linux":  {GOOS: "darwin", EffectiveUID: 0, Executable: ProductionExecutablePath, ArgumentCount: 1},
		"non-root":   {GOOS: "linux", EffectiveUID: 1000, Executable: ProductionExecutablePath, ArgumentCount: 1},
		"wrong-path": {GOOS: "linux", EffectiveUID: 0, Executable: "/tmp/atlas-manager-power-helper", ArgumentCount: 1},
		"argument":   {GOOS: "linux", EffectiveUID: 0, Executable: ProductionExecutablePath, ArgumentCount: 2},
	} {
		if ValidateStartup(invalid) {
			t.Fatalf("invalid startup accepted: %s", name)
		}
	}
}
