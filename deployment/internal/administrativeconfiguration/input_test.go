package administrativeconfiguration

import "testing"

func TestValidateInputRejectsDuplicateAndUnknownFields(t *testing.T) {
	valid := []byte(`{"schemaVersion":1,"cloudflareTeamName":"example-team","cloudflareAudience":"audience","roleAssignments":[{"principalId":"00000000-0000-4000-8000-000000000001","roles":["administrator"]}],"registeredServices":[]}`)
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

func contains(value []byte, fragment string) bool {
	for index := 0; index+len(fragment) <= len(value); index++ {
		if string(value[index:index+len(fragment)]) == fragment {
			return true
		}
	}
	return false
}
