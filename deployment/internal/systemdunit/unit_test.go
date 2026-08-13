package systemdunit

import (
	"strings"
	"testing"
)

func TestDefaultMockProfileHasNoPowerAuthority(t *testing.T) {
	if DefaultProfile != ProfileMock {
		t.Fatal("default profile must remain mock")
	}
	if !Validate(Content) {
		t.Fatal("mock unit does not satisfy the reviewed contract")
	}
	for _, required := range []string{
		"StateDirectoryMode=0700",
		"RuntimeDirectoryMode=0700",
		"/var/lib/atlas-manager-service-availability",
		"/var/lib/atlas-manager-machine-power",
		"NoNewPrivileges=true",
		"RestrictSUIDSGID=true",
	} {
		if !strings.Contains(Content, required) {
			t.Fatalf("mock unit must contain %q", required)
		}
	}
	for _, forbidden := range []string{"SupplementaryGroups=", "atlas-manager-power"} {
		if strings.Contains(Content, forbidden) {
			t.Fatalf("mock unit carries unnecessary power authority: %q", forbidden)
		}
	}
}

func TestPowerEnabledProfileRequiresExplicitSelection(t *testing.T) {
	selected, err := ContentFor(ProfilePowerEnabled)
	if err != nil || selected != PowerEnabledContent {
		t.Fatal("explicit power-enabled profile was not selected")
	}
	if !ValidateForProfile(selected, ProfilePowerEnabled) {
		t.Fatal("power-enabled profile does not satisfy its contract")
	}
	if Validate(selected) {
		t.Fatal("power-enabled profile was accepted as the default")
	}
	if _, err := ContentFor(""); err == nil {
		t.Fatal("implicit profile selection was accepted")
	}
}

func TestProfilesCannotConfigureOrBypassPowerActivationGates(t *testing.T) {
	for name, value := range map[string]string{
		"mock":          Content,
		"power-enabled": PowerEnabledContent,
	} {
		for _, forbidden := range []string{
			"POWER_MANAGEMENT_BACKEND=",
			"MACHINE_POWER_EFFECTS_ACTIVATION=",
			"MACHINE_POWER_EFFECTS_CONFIRMATION=",
			"LINUX_POWER_HELPER_EXPECTED_SHA256=",
			"MACHINE_POWER_SCHEDULER_ENABLED=",
			"ADMINISTRATIVE_WAKE_ALARM_HTTP_ENABLED=",
			"ADMINISTRATIVE_SHUTDOWN_HTTP_ENABLED=",
			"/usr/local/libexec/atlas-manager-power-helper",
		} {
			if strings.Contains(value, forbidden) {
				t.Fatalf("%s profile bypasses an independent power gate: %s", name, forbidden)
			}
		}
	}
}

func TestRejectsProfileCrossOverAndGateInjection(t *testing.T) {
	if Validate(Content + "\nSupplementaryGroups=atlas-manager-power\n") {
		t.Fatal("mock profile accepted helper group authority")
	}
	if ValidateForProfile(PowerEnabledContent+"\nNoNewPrivileges=true\n", ProfilePowerEnabled) {
		t.Fatal("power-enabled profile accepted helper-incompatible hardening")
	}
	if ValidateForProfile(strings.Replace(PowerEnabledContent, "SupplementaryGroups=atlas-manager-power", "SupplementaryGroups=atlas-manager-power docker", 1), ProfilePowerEnabled) {
		t.Fatal("power-enabled profile accepted an additional supplementary group")
	}
	if Validate(Content + "\nMACHINE_POWER_EFFECTS_ACTIVATION=linux_helper\n") {
		t.Fatal("systemd profile accepted an activation gate override")
	}
}

func TestRejectsEveryUnreviewedSystemdDirectiveOrOverride(t *testing.T) {
	for name, injected := range map[string]string{
		"root user override":        "User=root",
		"ambient boot capability":   "AmbientCapabilities=CAP_SYS_BOOT",
		"capability bounding set":   "CapabilityBoundingSet=CAP_SYS_BOOT",
		"filesystem override":       "ProtectSystem=false",
		"second executable":         "ExecStart=/usr/bin/false",
		"executable list reset":     "ExecStart=",
		"power group after comment": "# SupplementaryGroups=atlas-manager-power",
	} {
		t.Run(name, func(t *testing.T) {
			if Validate(Content + injected + "\n") {
				t.Fatalf("mock profile accepted %q", injected)
			}
			if ValidateForProfile(PowerEnabledContent+injected+"\n", ProfilePowerEnabled) {
				t.Fatalf("power-enabled profile accepted %q", injected)
			}
		})
	}
}

func TestAcceptsOnlyKnownPowerReadyPredecessorsForManagedUpgrade(t *testing.T) {
	if !ValidateManaged(PowerEnabledContent) || !ValidateManaged(previousPowerReadyContent) || !ValidateManaged(legacyPowerEnabledContent) {
		t.Fatal("known predecessor must be accepted during managed upgrade")
	}
	if Validate(PowerEnabledContent) || Validate(previousPowerReadyContent) || Validate(legacyPowerEnabledContent) {
		t.Fatal("candidate validation must require the mock contract")
	}
	if ValidateManaged(legacyPowerEnabledContent + "\nNoNewPrivileges=true\n") {
		t.Fatal("modified predecessor must be rejected")
	}
	if ValidateManaged(legacyPowerEnabledContent + "\n") {
		t.Fatal("predecessor with unreviewed trailing bytes must be rejected")
	}
}
