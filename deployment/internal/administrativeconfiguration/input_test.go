package administrativeconfiguration

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProductionPathsKeepAdministrativeInputOutsideBundle(t *testing.T) {
	paths := ProductionPaths("/opt/atlas-manager/releases/1.0.0-rc.7")
	if paths.Input != "/etc/atlas-manager/administrative-runtime.input.json" {
		t.Fatalf("unexpected external input path: %s", paths.Input)
	}
	if filepath.Dir(paths.Input) == paths.BundleRoot {
		t.Fatal("administrative input must not be inside the bundle")
	}
}

func TestValidateInputActionRequiresRestrictiveExternalFileMetadata(t *testing.T) {
	root := t.TempDir()
	inputPath := filepath.Join(root, "administrative-runtime.input.json")
	if err := os.WriteFile(inputPath, ExampleInputBytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	configuration := New(Paths{Input: inputPath}, Dependencies{
		EffectiveUID: func() int { return 0 },
		Platform:     func() string { return "linux" },
		Architecture: func() string { return "amd64" },
	})
	if report, err := configuration.Run(context.Background(), ValidateInputAction, ""); err != nil || report.Result != "valid_input" {
		t.Fatalf("valid external input rejected: report=%+v err=%v", report, err)
	}
	if err := os.Chmod(inputPath, 0o644); err != nil {
		t.Fatal(err)
	}
	if report, err := configuration.Run(context.Background(), ValidateInputAction, ""); err != nil || report.Configuration.Code != "administrative_input_invalid" {
		t.Fatalf("unsafe input metadata accepted: report=%+v err=%v", report, err)
	}
}

func TestValidateInputRejectsDuplicateAndUnknownFields(t *testing.T) {
	valid := ExampleInputBytes()
	if _, err := ValidateInput(valid); err != nil {
		t.Fatalf("valid input rejected: %v", err)
	}
	for _, value := range []string{
		`{"schemaVersion":1,"schemaVersion":1,"cloudflareTeamName":"example-team","cloudflareAudience":"audience","roleAssignments":[],"registeredServices":[]}`,
		`{"schemaVersion":1,"cloudflareTeamName":"example-team","cloudflareAudience":"audience","roleAssignments":[{"principalId":"00000000-0000-4000-8000-000000000001","roles":["unknown"]}],"registeredServices":[]}`,
	} {
		if _, err := ValidateInput([]byte(value)); err == nil {
			t.Fatalf("unsafe input accepted: %s", value)
		}
	}
}

func TestValidateInputAcceptsUUIDV4UUIDV5AndEmptyBackupTargets(t *testing.T) {
	for _, principal := range []string{
		"00000000-0000-4000-8000-000000000001",
		"caf45cc3-4312-5d41-8603-cc0102346a1f",
	} {
		data := strings.Replace(string(ExampleInputBytes()), "00000000-0000-4000-8000-000000000001", principal, 1)
		data = strings.Replace(data, `"backupTargets":[{"id":"example-backup","displayName":"Example backup","kind":"mock","schedule":{"mode":"manual"},"retention":{"keepLastSuccessful":7},"limits":{"maxFiles":1000,"maxTotalBytes":1073741824,"maxFileBytes":268435456,"maxDepth":16,"maxRelativePathBytes":4096}}]`, `"backupTargets":[]`, 1)
		if _, err := ValidateInput([]byte(data)); err != nil {
			t.Fatalf("principal %s rejected: %v", principal, err)
		}
	}
}

func TestValidateRealAdministrativeInput(t *testing.T) {
	data := string(ExampleInputBytes())
	data = strings.Replace(data, "example-team", "small-violet-e3d9", 1)
	data = strings.Replace(data, "replace-with-access-application-audience", "b80339017125d50c8f3ae93b62cc9eed1e01d9fe178a82ca4c56735034de3589", 1)
	data = strings.Replace(data, "https://atlas.example.com", "https://admin.gustavopinto.dev.br", 1)
	data = strings.Replace(data, "00000000-0000-4000-8000-000000000001", "caf45cc3-4312-5d41-8603-cc0102346a1f", 1)
	data = strings.Replace(data, `"backupTargets":[{"id":"example-backup","displayName":"Example backup","kind":"mock","schedule":{"mode":"manual"},"retention":{"keepLastSuccessful":7},"limits":{"maxFiles":1000,"maxTotalBytes":1073741824,"maxFileBytes":268435456,"maxDepth":16,"maxRelativePathBytes":4096}}]`, `"backupTargets":[]`, 1)
	if _, err := ValidateInput([]byte(data)); err != nil {
		t.Fatalf("real administrative input rejected: %v", err)
	}
}

func TestValidPublicOriginRejectsUnsafeValues(t *testing.T) {
	for _, value := range []string{
		"http://admin.gustavopinto.dev.br",
		"https://admin.gustavopinto.dev.br/admin",
		"https://*.gustavopinto.dev.br",
		"https://127.0.0.1",
		"https://admin.gustavopinto.dev.br?query=1",
		"https://admin.gustavopinto.dev.br#fragment",
		"https://user:pass@admin.gustavopinto.dev.br",
	} {
		if validPublicOrigin(value) {
			t.Fatalf("unsafe public origin accepted: %s", value)
		}
	}
}

func TestEnvironmentKeepsPowerSurfacesDisabled(t *testing.T) {
	input, err := ValidateInput(ExampleInputBytes())
	if err != nil {
		t.Fatal(err)
	}
	environment, err := Environment(input)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{
		"POWER_MANAGEMENT_BACKEND=mock\n",
		"MACHINE_POWER_EFFECTS_ACTIVATION=disabled\n",
		"MACHINE_POWER_SCHEDULER_ENABLED=false\n",
		"ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\n",
		"ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\n",
	} {
		if !contains(environment, required) {
			t.Fatalf("profile missing %q", required)
		}
	}
}

func TestStateRejectsIncompleteGenerationEvidence(t *testing.T) {
	base := State{
		SchemaVersion:       1,
		Profile:             ProfileName,
		ConfigurationSHA256: strings.Repeat("a", 64),
		SourceInputSHA256:   strings.Repeat("b", 64),
		ApplicationVersion:  "1.0.0-rc.6",
		SourceCommit:        strings.Repeat("c", 40),
		Status:              "installed",
		CurrentGeneration:   1,
	}
	if !validState(base) {
		t.Fatal("first generation state rejected")
	}
	base.PreviousGeneration = 1
	if validState(base) {
		t.Fatal("equal current and previous generations accepted")
	}
	base.PreviousGeneration = 0
	base.PreviousConfigurationSHA256 = strings.Repeat("d", 64)
	if validState(base) {
		t.Fatal("previous hash without previous generation accepted")
	}
}

func contains(value []byte, fragment string) bool {
	for index := 0; index+len(fragment) <= len(value); index++ {
		if string(value[index:index+len(fragment)]) == fragment {
			return true
		}
	}
	return false
}
