package bundle

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"testing"
)

const testCommit = "df23dc5ecdeb1ea65f020331c6281cb3776d8d34"

func TestManifestAndVersionAreStrict(t *testing.T) {
	for _, value := range []string{"0.1.0", "1.2.3-alpha.1", "1.2.3+build.4"} {
		if err := ValidatePackageVersion(value); err != nil {
			t.Fatalf("expected version %q: %v", value, err)
		}
	}
	for _, value := range []string{"", " 1.0.0", "1.0", "1.0.0/evil", "1.0.0-", "1.0.0+", "1.0.0\\x"} {
		if err := ValidatePackageVersion(value); err == nil {
			t.Fatalf("expected invalid version %q", value)
		}
	}
	for _, value := range []string{"0", "1", "1722470400"} {
		if _, err := ParseSourceDateEpoch(value); err != nil {
			t.Fatalf("expected epoch %q: %v", value, err)
		}
	}
	for _, value := range []string{"", "01", "-1", " 1", "18446744073709551616"} {
		if _, err := ParseSourceDateEpoch(value); err == nil {
			t.Fatalf("expected invalid epoch %q", value)
		}
	}
}

func TestManifestPinsGOAMD64V1(t *testing.T) {
	manifest := BuildManifest("0.1.0", testCommit, "1.23.0", 0, []byte("helper"), []byte("installer"), []byte("qualification"))
	if manifest.GOAMD64 != TargetGOAMD64 || TargetGOAMD64 != "v1" {
		t.Fatalf("unexpected GOAMD64 baseline: %q", manifest.GOAMD64)
	}
	for _, value := range []string{"", "v2", "v3", "v4", "V1", "amd64.v1"} {
		invalid := manifest
		invalid.GOAMD64 = value
		if err := ValidateManifest(invalid); err == nil {
			t.Fatalf("accepted invalid GOAMD64 value %q", value)
		}
	}
	canonical, err := CanonicalManifest(manifest)
	if err != nil || !bytes.Contains(canonical, []byte(`"goamd64":"v1"`)) {
		t.Fatalf("manifest does not serialize GOAMD64=v1: %s", canonical)
	}
}

func TestBundleIsCanonicalAndReproducible(t *testing.T) {
	helper := []byte("helper payload")
	installer := []byte("installer payload")
	qualification := []byte("qualification payload")
	manifest := BuildManifest("0.1.0", testCommit, "1.23.0", 0, helper, installer, qualification)
	first := filepath.Join(t.TempDir(), "atlas-manager-power-helper_0.1.0_linux_amd64")
	second := filepath.Join(t.TempDir(), "atlas-manager-power-helper_0.1.0_linux_amd64")
	for _, root := range []string{first, second} {
		if err := CreateDirectoryBundle(root, manifest, helper, installer, qualification, []byte("runbook\n")); err != nil {
			t.Fatal(err)
		}
		archivePath := root + ".tar.gz"
		if err := CreateArchive(root, archivePath, 0); err != nil {
			t.Fatal(err)
		}
		if _, err := ParseManifest(mustRead(t, filepath.Join(root, "manifest.json"))); err != nil {
			t.Fatal(err)
		}
		if err := ValidateBundleDirectory(root, manifest); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"manifest.json", "SHA256SUMS"} {
		if !bytes.Equal(mustRead(t, filepath.Join(first, name)), mustRead(t, filepath.Join(second, name))) {
			t.Fatalf("%s differs between reproducible bundles", name)
		}
	}
	firstArchive := mustRead(t, first+".tar.gz")
	secondArchive := mustRead(t, second+".tar.gz")
	if !bytes.Equal(firstArchive, secondArchive) {
		t.Fatal("archives differ between reproducible bundles")
	}
	reader, err := gzip.NewReader(bytes.NewReader(firstArchive))
	if err != nil {
		t.Fatal(err)
	}
	tarReader := tar.NewReader(reader)
	var names []string
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		names = append(names, header.Name)
		if header.Uid != 0 || header.Gid != 0 || header.Uname != "root" || header.Gname != "root" || header.ModTime.Unix() != 0 {
			t.Fatalf("noncanonical archive metadata: %#v", header)
		}
	}
	if len(names) != 11 || names[0] != "atlas-manager-power-helper_0.1.0_linux_amd64" {
		t.Fatalf("unexpected archive entries: %v", names)
	}
}

func TestUnexpectedBundleFilesReject(t *testing.T) {
	root := filepath.Join(t.TempDir(), "bundle")
	helper, installer, qualification := []byte("h"), []byte("i"), []byte("q")
	manifest := BuildManifest("0.1.0", testCommit, "1.23.0", 0, helper, installer, qualification)
	if err := CreateDirectoryBundle(root, manifest, helper, installer, qualification, nil); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "bin", "extra"), []byte("x"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := ValidateBundleDirectory(root, manifest); err == nil {
		t.Fatal("expected unexpected bundle file rejection")
	}
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return data
}
