package servicelifecycle

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/administrativeconfiguration"
)

func TestAdministrativeProfileMarkersAcceptCurrentAndEnabledMockPowerSurfaces(t *testing.T) {
	var input administrativeconfiguration.Input
	if err := json.Unmarshal(administrativeconfiguration.ExampleInputBytes(), &input); err != nil {
		t.Fatal(err)
	}
	environment, err := administrativeconfiguration.Environment(input)
	if err != nil {
		t.Fatal(err)
	}
	if !isAdministrativeProfile(environment) {
		t.Fatal("current administrative profile was not recognized")
	}
	input.WakeAlarmHTTPEnabled = true
	input.ShutdownHTTPEnabled = true
	enabled, err := administrativeconfiguration.Environment(input)
	if err != nil {
		t.Fatal(err)
	}
	if !isAdministrativeProfile(enabled) {
		t.Fatal("mock power administrative profile was not recognized")
	}
}

func TestAdministrativeProfileRejectsPartialAndAmbiguousEnvironment(t *testing.T) {
	var input administrativeconfiguration.Input
	if err := json.Unmarshal(administrativeconfiguration.ExampleInputBytes(), &input); err != nil {
		t.Fatal(err)
	}
	environment, err := administrativeconfiguration.Environment(input)
	if err != nil {
		t.Fatal(err)
	}
	for name, candidate := range map[string]string{
		"missing event-history operation surface": strings.Replace(string(environment), "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED=true\n", "", 1),
		"duplicate public origin":                 string(environment) + "ADMINISTRATIVE_PUBLIC_ORIGIN=https://other.example.test\n",
		"prefixed marker":                         strings.Replace(string(environment), "ADMINISTRATIVE_ROLE_ASSIGNMENTS=", "XADMINISTRATIVE_ROLE_ASSIGNMENTS=", 1),
		"crlf":                                    strings.Replace(string(environment), "POWER_MANAGEMENT_BACKEND=mock\n", "POWER_MANAGEMENT_BACKEND=mock\r\n", 1),
		"invalid power flag":                      strings.Replace(string(environment), "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\n", "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=enabled\n", 1),
	} {
		if isAdministrativeProfile([]byte(candidate)) {
			t.Fatalf("%s was accepted", name)
		}
	}
}

func TestAdministrativeHostRejectsDuplicateOrigin(t *testing.T) {
	data := []byte("ADMINISTRATIVE_PUBLIC_ORIGIN=https://admin.example.test\nADMINISTRATIVE_PUBLIC_ORIGIN=https://other.example.test\n")
	if _, err := administrativeHost(data); err == nil {
		t.Fatal("duplicate public origin was accepted")
	}
}

func TestValidateConfigurationAcceptsPersistedAdministrativeStateContract(t *testing.T) {
	var input administrativeconfiguration.Input
	if err := json.Unmarshal(administrativeconfiguration.ExampleInputBytes(), &input); err != nil {
		t.Fatal(err)
	}
	environment, err := administrativeconfiguration.Environment(input)
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	environmentPath := root + "/atlas-manager.env"
	statePath := root + "/state.json"
	if err := os.WriteFile(environmentPath, environment, 0o640); err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(administrativeconfiguration.State{
		SchemaVersion:       1,
		Profile:             "mock-administrative",
		ConfigurationSHA256: hashConfiguration(environment),
		ApplicationVersion:  "1.0.0-rc.7",
		SourceCommit:        strings.Repeat("a", 40),
		Status:              "installed",
		CurrentGeneration:   1,
		PreviousGeneration:  0,
		SourceInputSHA256:   strings.Repeat("b", 64),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, state, 0o600); err != nil {
		t.Fatal(err)
	}
	service := Service{paths: Paths{ConfigEnvironment: environmentPath, AdministrativeConfigState: statePath}}
	if err := service.validateConfiguration(); err != nil {
		t.Fatalf("persisted administrative state should be accepted: %v", err)
	}
}
