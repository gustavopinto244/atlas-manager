package manifest

import "testing"

func validManifest() Manifest {
	return Manifest{
		SchemaVersion: 1, Name: "atlas-manager", Version: "0.1.0",
		SourceCommit: "0123456789abcdef0123456789abcdef01234567", SourceDateEpoch: 0,
		Target: Target{OS: "linux", Arch: "amd64"}, NodeVersion: "24.18.0", NPMVersion: "11.16.0", GoVersion: "1.23.0",
		RuntimeNodePath: "/usr/bin/node", SystemdUnitPath: "/etc/systemd/system/atlas-manager.service",
		Files: []File{{Path: "application/dist/main.js", Size: 1, Mode: 0o644, SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}},
	}
}

func TestManifestRoundTrip(t *testing.T) {
	encoded, err := Encode(validManifest())
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := Decode(encoded)
	if err != nil || decoded.Version != "0.1.0" {
		t.Fatalf("decoded = %#v, err = %v", decoded, err)
	}
}

func TestManifestRejectsDuplicateFieldsAndUnsafePaths(t *testing.T) {
	if _, err := Decode([]byte(`{"schemaVersion":1,"schemaVersion":1}`)); err == nil {
		t.Fatal("duplicate field accepted")
	}
	if _, err := Decode([]byte(`{"schemaVersion":1,"name":"atlas-manager","version":"0.1.0","sourceCommit":"0123456789abcdef0123456789abcdef01234567","sourceDateEpoch":0,"target":{"os":"linux","os":"linux","arch":"amd64"},"nodeVersion":"24.18.0","npmVersion":"11.16.0","goVersion":"1.23.0","runtimeNodePath":"/usr/bin/node","systemdUnitPath":"/etc/systemd/system/atlas-manager.service","files":[]}`)); err == nil {
		t.Fatal("nested duplicate field accepted")
	}
	value := validManifest()
	value.Files[0].Path = "../escape"
	if err := value.Validate(); err == nil {
		t.Fatal("unsafe path accepted")
	}
}
