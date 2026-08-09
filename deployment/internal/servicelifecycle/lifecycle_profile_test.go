package servicelifecycle

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/administrativeconfiguration"
)

func TestAdministrativeProfileMarkersAcceptCurrentAndLegacyOptionalSurfaces(t *testing.T) {
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
	legacyOptional := strings.ReplaceAll(string(environment), "ADMINISTRATIVE_EVENT_HISTORY_OPERATIONS_HTTP_ENABLED=true\n", "")
	legacyOptional = strings.ReplaceAll(legacyOptional, "SERVICE_AVAILABILITY_RECONCILIATION_SCHEDULER_CURSOR_FILE=/var/lib/atlas-manager-service-availability/scheduler-cursor.json\n", "")
	legacyOptional = strings.ReplaceAll(legacyOptional, "SERVICE_AVAILABILITY_RECONCILIATION_OCCURRENCE_CLAIM_FILE=/var/lib/atlas-manager-service-availability/occurrence-claims.jsonl\n", "")
	legacyOptional = strings.ReplaceAll(legacyOptional, "SERVICE_AVAILABILITY_OVERRIDE_FILE=/var/lib/atlas-manager-service-availability/overrides.json\n", "")
	if !isAdministrativeProfile([]byte(legacyOptional)) {
		t.Fatal("legacy optional administrative profile was not recognized")
	}
	enabled := strings.ReplaceAll(string(environment), "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=false\n", "ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=true\n")
	enabled = strings.ReplaceAll(enabled, "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=false\n", "ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=true\n")
	if !isAdministrativeProfile([]byte(enabled)) {
		t.Fatal("mock power administrative profile was not recognized")
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
