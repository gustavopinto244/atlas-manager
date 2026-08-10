package nodeversion

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestSupportedAcceptsAnyPatchInsideTheRange(t *testing.T) {
	for _, value := range []string{"v24.0.0", "v24.18.0", "v24.18.1\n", "  v24.99.100  ", "v24.0.1"} {
		if !Supported(value) {
			t.Fatalf("supported release rejected: %q", value)
		}
	}
}

func TestSupportedRejectsReleasesOutsideTheRange(t *testing.T) {
	for _, value := range []string{
		"v23.11.0",
		"v25.0.0",
		"v22.18.0",
		"v2.4.18",
		"",
		"24.18.0",
		"v24.18",
		"v24.18.0.1",
		"v24.18.0-nightly20260101",
		"v24.18.0+build",
		"vx.y.z",
		"v24.018.0",
		"v-24.18.0",
		"v24.18.0 && rm -rf /",
	} {
		if Supported(value) {
			t.Fatalf("unsupported release accepted: %q", value)
		}
	}
}

// The engines field in package.json is the declared source of truth for the
// supported runtime. This test fails if the two drift apart.
func TestSupportedRangeMatchesPackageEngines(t *testing.T) {
	path := filepath.Join("..", "..", "..", "package.json")
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var document struct {
		Engines struct {
			Node string `json:"node"`
		} `json:"engines"`
	}
	if err := json.Unmarshal(content, &document); err != nil {
		t.Fatal(err)
	}
	if document.Engines.Node != Range {
		t.Fatalf("engines.node is %q but the deployment supports %q", document.Engines.Node, Range)
	}
}
