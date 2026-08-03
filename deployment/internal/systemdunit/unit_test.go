package systemdunit

import (
	"strings"
	"testing"
)

func TestContentMatchesDisabledRuntimeContract(t *testing.T) {
	if !Validate(Content) {
		t.Fatal("unit does not satisfy the reviewed contract")
	}
	for _, required := range []string{"StateDirectoryMode=0700", "RuntimeDirectoryMode=0700"} {
		if !strings.Contains(Content, required) {
			t.Fatalf("unit must declare private managed state: %s", required)
		}
	}
}

func TestRejectsHelperIncompatibleHardening(t *testing.T) {
	if Validate(Content + "\nNoNewPrivileges=true\n") {
		t.Fatal("incompatible hardening must be rejected")
	}
}
