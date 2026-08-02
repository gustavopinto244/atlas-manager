package runtimeconfiguration

import (
	"testing"
)

func TestMockProfileIsCanonical(t *testing.T) {
	if err := ValidateProfile(ProfileBytes()); err != nil {
		t.Fatal(err)
	}
	if ProfileSHA256() == "" || len(ProfileSHA256()) != 64 {
		t.Fatal("profile digest is not canonical")
	}
	for _, action := range []string{"inspect", "install-mock", "verify-mock", "remove-mock"} {
		if !ValidAction(action) {
			t.Fatalf("action %q rejected", action)
		}
	}
	for _, action := range []string{"edit", "repair", "enable-power", ""} {
		if ValidAction(action) {
			t.Fatalf("unsupported action %q accepted", action)
		}
	}
}

func TestStateRejectsNonCanonicalValues(t *testing.T) {
	valid := State{SchemaVersion: 1, Profile: ProfileName, ConfigurationSHA256: ProfileSHA256(), ApplicationVersion: "0.1.0", SourceCommit: "0123456789abcdef0123456789abcdef01234567", Status: "installed"}
	if err := ValidateState(valid); err != nil {
		t.Fatal(err)
	}
	valid.ConfigurationSHA256 = "0"
	if err := ValidateState(valid); err == nil {
		t.Fatal("short digest accepted")
	}
}
