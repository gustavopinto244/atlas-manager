package systemdunit

import "testing"

func TestContentMatchesDisabledRuntimeContract(t *testing.T) {
	if !Validate(Content) {
		t.Fatal("unit does not satisfy the reviewed contract")
	}
}

func TestRejectsHelperIncompatibleHardening(t *testing.T) {
	if Validate(Content + "\nNoNewPrivileges=true\n") {
		t.Fatal("incompatible hardening must be rejected")
	}
}
