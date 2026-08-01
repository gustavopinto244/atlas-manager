package main

import (
	"os"
	"strings"
	"testing"
)

func TestFixedBuildEnvironmentOverridesExternalGOAMD64(t *testing.T) {
	t.Setenv("GOAMD64", "v3")
	values := fixedBuildEnvironment(1722470400)
	var found string
	for _, value := range values {
		if strings.HasPrefix(value, "GOAMD64=") {
			if found != "" {
				t.Fatal("duplicate GOAMD64 value")
			}
			found = value
		}
	}
	if found != "GOAMD64=v1" {
		t.Fatalf("GOAMD64 = %q", found)
	}
	if os.Getenv("GOAMD64") != "v3" {
		t.Fatal("test environment was unexpectedly changed")
	}
}
