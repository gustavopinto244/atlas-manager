package bundle

import "testing"

func TestToolVersionMatchesPinnedTools(t *testing.T) {
	if !toolVersionMatches("node", "v24.18.0\n", "v24.18.0") {
		t.Fatal("node version rejected")
	}
	if !toolVersionMatches("npm", "11.16.0\n", "11.16.0") {
		t.Fatal("npm version rejected")
	}
	if !toolVersionMatches("go", "go version go1.23.0 linux/amd64\n", "go1.23.0") {
		t.Fatal("go version rejected")
	}
	if toolVersionMatches("node", "v23.0.0\n", "v24.18.0") {
		t.Fatal("wrong node version accepted")
	}
	if toolVersionMatches("go", "go version go1.23.0 linux/arm64\n", "go1.23.0") {
		t.Fatal("wrong go target accepted")
	}
}

func TestValidateConfigRejectsNonPinnedToolVersions(t *testing.T) {
	config := Config{Version: "0.1.0", SourceCommit: "0123456789abcdef0123456789abcdef01234567", SourceDateEpoch: 0, SourceRoot: "/source", OutputDir: "/output", NodeVersion: "23.0.0", NPMVersion: PinnedNPM, GoVersion: PinnedGo}
	if err := validateConfig(config); err == nil {
		t.Fatal("non-pinned node version accepted")
	}
}
