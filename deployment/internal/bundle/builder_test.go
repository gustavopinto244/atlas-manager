package bundle

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
)

func TestVerifyServedDashboardAssetsRejectsUnbundledEntrypoint(t *testing.T) {
	for name, served := range map[string]string{
		"import statement": "import {x} from \"./navigation.js\";\nx();\n",
		"export statement": "export const value = 1;\n",
		"indented import":  "  import \"./navigation.js\";\n",
	} {
		root := t.TempDir()
		writeDashboardBuild(t, root, served)
		if err := verifyServedDashboardAssets(root); err == nil {
			t.Fatalf("%s accepted as a bundled dashboard entrypoint", name)
		} else if err.Error() != "dashboard_app_not_bundled" {
			t.Fatalf("%s produced unexpected error: %v", name, err)
		}
	}
}

func TestVerifyServedDashboardAssetsAcceptsBundledEntrypoint(t *testing.T) {
	root := t.TempDir()
	writeDashboardBuild(t, root, "\"use strict\";\n(() => {\n  const x = 1;\n})();\n")
	if err := verifyServedDashboardAssets(root); err != nil {
		t.Fatalf("bundled dashboard entrypoint rejected: %v", err)
	}
}

func TestVerifyServedDashboardAssetsRequiresBothAssets(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "dist", "dashboard"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "dist", "dashboard", "main.js"), []byte("\"use strict\";\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := verifyServedDashboardAssets(root); err == nil {
		t.Fatal("missing served stylesheet accepted")
	}
}

func writeDashboardBuild(t *testing.T, root, servedApp string) {
	t.Helper()
	directory := filepath.Join(root, "dist", "dashboard")
	if err := os.MkdirAll(directory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "main.js"), []byte(servedApp), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "styles.css"), []byte("body{margin:0}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestRejectEnvironmentSecretsBlocksOperatorEnvironmentFiles(t *testing.T) {
	for _, name := range []string{".env", ".env.operator", ".env.production", ".env.local"} {
		root := t.TempDir()
		if err := os.MkdirAll(filepath.Join(root, "application", "dist"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(root, "application", "dist", name), []byte("SECRET=value\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		err := rejectEnvironmentSecrets(root)
		if err == nil {
			t.Fatalf("%s was accepted into the bundle", name)
		}
		if err.Error() != "bundle_environment_secret_present" {
			t.Fatalf("%s produced unexpected error: %v", name, err)
		}
	}
}

func TestRejectEnvironmentSecretsAllowsTheConfigurationTemplate(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "config"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config", "atlas-manager.env.example"), []byte("HOST=127.0.0.1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := rejectEnvironmentSecrets(root); err != nil {
		t.Fatalf("configuration template rejected: %v", err)
	}
}

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

type modeBundleFixture struct {
	manifest       []byte
	checksums      []byte
	archive        []byte
	tarModes       map[string]int64
	extractedModes map[string]os.FileMode
}

func TestCanonicalBundleModesAreUmaskIndependent(t *testing.T) {
	first := buildModeBundleFixture(t, 0o664, 0o775, 0o775)
	second := buildModeBundleFixture(t, 0o644, 0o755, 0o755)

	if !bytes.Equal(first.manifest, second.manifest) {
		t.Fatal("manifest differs for source modes with identical content")
	}
	if !bytes.Equal(first.checksums, second.checksums) {
		t.Fatal("checksums differ for source modes with identical content")
	}
	if !bytes.Equal(first.archive, second.archive) {
		t.Fatal("archive differs for source modes with identical content")
	}

	expected := map[string]int64{
		"atlas-manager_1.0.0-rc.7_linux_amd64/":                            0o755,
		"atlas-manager_1.0.0-rc.7_linux_amd64/application/":                0o755,
		"atlas-manager_1.0.0-rc.7_linux_amd64/application/dist/":           0o755,
		"atlas-manager_1.0.0-rc.7_linux_amd64/application/dist/common.txt": 0o644,
		"atlas-manager_1.0.0-rc.7_linux_amd64/application/dist/run.sh":     0o755,
	}
	for name, mode := range expected {
		if first.tarModes[name] != mode || second.tarModes[name] != mode {
			t.Fatalf("tar mode for %q was %o and %o, want %o", name, first.tarModes[name], second.tarModes[name], mode)
		}
		if first.extractedModes[name] != os.FileMode(mode) || second.extractedModes[name] != os.FileMode(mode) {
			t.Fatalf("extracted mode for %q was %o and %o, want %o", name, first.extractedModes[name], second.extractedModes[name], mode)
		}
	}
}

func TestCanonicalBundleModeRejectsSymlinksAndSpecialFiles(t *testing.T) {
	root := t.TempDir()
	link := filepath.Join(root, "link")
	if err := os.Symlink("target", link); err != nil {
		t.Fatal(err)
	}
	linkInfo, err := os.Lstat(link)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := canonicalBundleMode(linkInfo); err == nil {
		t.Fatal("symlink accepted")
	}

	fifo := filepath.Join(root, "fifo")
	if err := syscall.Mkfifo(fifo, 0o644); err != nil {
		t.Fatal(err)
	}
	fifoInfo, err := os.Lstat(fifo)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := canonicalBundleMode(fifoInfo); err == nil {
		t.Fatal("special file accepted")
	}
}

func buildModeBundleFixture(t *testing.T, commonMode, executableMode, directoryMode os.FileMode) modeBundleFixture {
	t.Helper()
	parent := t.TempDir()
	source := filepath.Join(parent, "source")
	root := filepath.Join(parent, "atlas-manager_1.0.0-rc.7_linux_amd64")
	archive := filepath.Join(parent, "atlas-manager_1.0.0-rc.7_linux_amd64.tar.gz")
	dist := filepath.Join(source, "application", "dist")
	if err := os.MkdirAll(dist, directoryMode); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{source, filepath.Join(source, "application"), dist} {
		if err := os.Chmod(path, directoryMode); err != nil {
			t.Fatal(err)
		}
	}
	common := filepath.Join(dist, "common.txt")
	executable := filepath.Join(dist, "run.sh")
	if err := os.WriteFile(common, []byte("same content\n"), commonMode); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, []byte("#!/bin/sh\nprintf test\n"), executableMode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(common, commonMode); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(executable, executableMode); err != nil {
		t.Fatal(err)
	}

	before := snapshotFixtureSource(t, source, []string{"application", "application/dist", "application/dist/common.txt", "application/dist/run.sh"})
	if err := copyTree(source, root); err != nil {
		t.Fatal(err)
	}
	if err := canonicalizeTree(root); err != nil {
		t.Fatal(err)
	}
	assertFixtureSourceUnchanged(t, source, before)

	paths := []string{"application/dist/common.txt", "application/dist/run.sh"}
	files, err := manifest.Inventory(root, paths)
	if err != nil {
		t.Fatal(err)
	}
	value := manifest.Manifest{
		SchemaVersion:   manifest.SchemaVersion,
		Name:            "atlas-manager",
		Version:         "1.0.0-rc.7",
		SourceCommit:    "0123456789abcdef0123456789abcdef01234567",
		SourceDateEpoch: 0,
		Target:          manifest.Target{OS: "linux", Arch: "amd64"},
		NodeVersion:     PinnedNode,
		NPMVersion:      PinnedNPM,
		GoVersion:       PinnedGo,
		RuntimeNodePath: "/usr/bin/node",
		SystemdUnitPath: "/etc/systemd/system/atlas-manager.service",
		Files:           files,
	}
	encoded, err := manifest.Encode(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "MANIFEST.json"), append(encoded, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := writeChecksums(root, value); err != nil {
		t.Fatal(err)
	}
	if err := archiveTree(context.Background(), root, archive, 0); err != nil {
		t.Fatal(err)
	}
	manifestBytes, err := os.ReadFile(filepath.Join(root, "MANIFEST.json"))
	if err != nil {
		t.Fatal(err)
	}
	checksumBytes, err := os.ReadFile(filepath.Join(root, "SHA256SUMS"))
	if err != nil {
		t.Fatal(err)
	}
	archiveBytes, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	return modeBundleFixture{manifest: manifestBytes, checksums: checksumBytes, archive: archiveBytes, tarModes: readTarModes(t, archive), extractedModes: extractTarModes(t, archive)}
}

type sourceFixtureEntry struct {
	mode os.FileMode
	data []byte
}

func snapshotFixtureSource(t *testing.T, root string, names []string) map[string]sourceFixtureEntry {
	t.Helper()
	result := make(map[string]sourceFixtureEntry, len(names))
	for _, name := range names {
		path := filepath.Join(root, filepath.FromSlash(name))
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		data, err := os.ReadFile(path)
		if info.IsDir() {
			data = nil
		}
		if err != nil && !info.IsDir() {
			t.Fatal(err)
		}
		result[name] = sourceFixtureEntry{mode: info.Mode().Perm(), data: data}
	}
	return result
}

func assertFixtureSourceUnchanged(t *testing.T, root string, before map[string]sourceFixtureEntry) {
	t.Helper()
	for name, expected := range before {
		path := filepath.Join(root, filepath.FromSlash(name))
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != expected.mode {
			t.Fatalf("source mode for %q changed from %o to %o", name, expected.mode, info.Mode().Perm())
		}
		if info.IsDir() {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(data, expected.data) {
			t.Fatalf("source content for %q changed", name)
		}
	}
}

func readTarModes(t *testing.T, archive string) map[string]int64 {
	t.Helper()
	file, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	result := make(map[string]int64)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		result[header.Name] = header.Mode
		if _, err := io.Copy(io.Discard, tarReader); err != nil {
			t.Fatal(err)
		}
	}
}

func extractTarModes(t *testing.T, archive string) map[string]os.FileMode {
	t.Helper()
	file, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer gzipReader.Close()
	root := t.TempDir()
	tarReader := tar.NewReader(gzipReader)
	result := make(map[string]os.FileMode)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			return result
		}
		if err != nil {
			t.Fatal(err)
		}
		target := filepath.Join(root, filepath.FromSlash(header.Name))
		if header.Typeflag == tar.TypeDir {
			if err := os.MkdirAll(target, 0o755); err != nil {
				t.Fatal(err)
			}
		} else {
			data, err := io.ReadAll(tarReader)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(target, data, os.FileMode(header.Mode)); err != nil {
				t.Fatal(err)
			}
		}
		if err := os.Chmod(target, os.FileMode(header.Mode)); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(target)
		if err != nil {
			t.Fatal(err)
		}
		result[header.Name] = info.Mode().Perm()
	}
}
