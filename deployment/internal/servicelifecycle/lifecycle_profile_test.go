package servicelifecycle

import (
	"encoding/json"
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
}
