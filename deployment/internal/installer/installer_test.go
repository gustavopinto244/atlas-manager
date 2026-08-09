package installer

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/atlas-manager/atlas-manager/deployment/internal/manifest"
	"github.com/atlas-manager/atlas-manager/deployment/internal/runtimeidentity"
	"github.com/atlas-manager/atlas-manager/deployment/internal/systemdunit"
)

func TestSandboxDisabledInstallUpgradeRollbackAndUninstall(t *testing.T) {
	root := t.TempDir()
	bundleA := createBundle(t, filepath.Join(root, "bundle-a"), "0.1.0")
	bundleB := createBundle(t, filepath.Join(root, "bundle-b"), "0.2.0")
	paths := sandboxPaths(filepath.Join(root, "host"))
	if err := os.MkdirAll(filepath.Dir(paths.Environment), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.Environment, []byte("SECRET=operator-owned\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	identity := runtimeidentity.Identity{UserID: 1001, PrimaryGroupID: 1001, HelperGroupID: 1002}
	newInstaller := func(bundle string) *Installer {
		return New(Config{
			Paths: paths, BundleRoot: bundle, EffectiveUID: func() int { return 0 },
			ResolveIdentity: func() (runtimeidentity.Identity, error) { return identity, nil },
			CheckNode:       func(_ context.Context) error { return nil }, ApplyOwnership: false,
		})
	}
	if err := newInstaller(bundleA).Run(context.Background(), InstallDisabled); err != nil {
		t.Fatal(err)
	}
	releaseInfo, err := os.Stat(filepath.Join(paths.ReleaseRoot, "0.1.0"))
	if err != nil {
		t.Fatal(err)
	}
	if mode := releaseInfo.Mode().Perm(); mode != 0o755 {
		t.Fatalf("release root mode = %04o, want 0755", mode)
	}
	if err := newInstaller(bundleA).Run(context.Background(), VerifyDisabled); err != nil {
		t.Fatal(err)
	}
	if err := newInstaller(bundleB).Run(context.Background(), InstallDisabled); err != nil {
		t.Fatal(err)
	}
	if err := newInstaller(bundleB).Run(context.Background(), VerifyDisabled); err != nil {
		t.Fatal(err)
	}
	if target, _ := os.Readlink(paths.Current); target != filepath.Join(paths.ReleaseRoot, "0.2.0") {
		t.Fatalf("current = %q", target)
	}
	if err := newInstaller(bundleB).Run(context.Background(), RollbackDisabled); err != nil {
		t.Fatal(err)
	}
	if target, _ := os.Readlink(paths.Current); target != filepath.Join(paths.ReleaseRoot, "0.1.0") {
		t.Fatalf("rollback current = %q", target)
	}
	if err := newInstaller(bundleA).Run(context.Background(), UninstallDisabled); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(paths.Environment); err != nil {
		t.Fatalf("operator configuration removed: %v", err)
	}
	if _, err := os.Stat(paths.StateHome); err != nil {
		t.Fatalf("application state parent removed: %v", err)
	}
}

func TestSandboxInstallerRejectsActiveRuntime(t *testing.T) {
	root := t.TempDir()
	bundle := createBundle(t, filepath.Join(root, "bundle"), "0.1.0")
	paths := sandboxPaths(filepath.Join(root, "host"))
	if err := os.MkdirAll(paths.RuntimeDir, 0o755); err != nil {
		t.Fatal(err)
	}
	installer := New(Config{Paths: paths, BundleRoot: bundle, EffectiveUID: func() int { return 0 }, ResolveIdentity: func() (runtimeidentity.Identity, error) {
		return runtimeidentity.Identity{UserID: 1, PrimaryGroupID: 1, HelperGroupID: 2}, nil
	}, CheckNode: func(_ context.Context) error { return nil }})
	if err := installer.Run(context.Background(), InstallDisabled); err == nil {
		t.Fatal("active runtime was accepted")
	}
}

func TestSandboxVerificationRejectsModifiedManagedRelease(t *testing.T) {
	root := t.TempDir()
	bundle := createBundle(t, filepath.Join(root, "bundle"), "0.1.0")
	paths := sandboxPaths(filepath.Join(root, "host"))
	identity := runtimeidentity.Identity{UserID: 1001, PrimaryGroupID: 1001, HelperGroupID: 1002}
	newInstaller := func() *Installer {
		return New(Config{
			Paths: paths, BundleRoot: bundle, EffectiveUID: func() int { return 0 },
			ResolveIdentity: func() (runtimeidentity.Identity, error) { return identity, nil },
			CheckNode:       func(_ context.Context) error { return nil },
		})
	}
	if err := newInstaller().Run(context.Background(), InstallDisabled); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.ReleaseRoot, "0.1.0", "dist", "main.js"), []byte("changed\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := newInstaller().Run(context.Background(), VerifyDisabled); err == nil {
		t.Fatal("modified managed release was accepted")
	}
}

func TestSandboxVerificationRejectsReleaseRootWithUnsafeMode(t *testing.T) {
	root := t.TempDir()
	bundle := createBundle(t, filepath.Join(root, "bundle"), "0.1.0")
	paths := sandboxPaths(filepath.Join(root, "host"))
	identity := runtimeidentity.Identity{
		UserID:         1001,
		PrimaryGroupID: 1001,
		HelperGroupID:  1002,
	}
	installer := New(Config{
		Paths:        paths,
		BundleRoot:   bundle,
		EffectiveUID: func() int { return 0 },
		ResolveIdentity: func() (runtimeidentity.Identity, error) {
			return identity, nil
		},
		CheckNode:      func(_ context.Context) error { return nil },
		ApplyOwnership: false,
	})

	if err := installer.Run(context.Background(), InstallDisabled); err != nil {
		t.Fatal(err)
	}

	release := filepath.Join(paths.ReleaseRoot, "0.1.0")
	if err := os.Chmod(release, 0o700); err != nil {
		t.Fatal(err)
	}

	err := installer.Run(context.Background(), VerifyDisabled)
	if err == nil || err.Error() != "release_invalid" {
		t.Fatalf("verify-disabled error = %v, want release_invalid", err)
	}
}

func TestSandboxRejectsUnknownReleaseArtifact(t *testing.T) {
	root := t.TempDir()
	bundle := createBundle(t, filepath.Join(root, "bundle"), "0.1.0")
	paths := sandboxPaths(filepath.Join(root, "host"))
	identity := runtimeidentity.Identity{UserID: 1001, PrimaryGroupID: 1001, HelperGroupID: 1002}
	newInstaller := func() *Installer {
		return New(Config{
			Paths: paths, BundleRoot: bundle, EffectiveUID: func() int { return 0 },
			ResolveIdentity: func() (runtimeidentity.Identity, error) { return identity, nil },
			CheckNode:       func(_ context.Context) error { return nil },
		})
	}
	if err := newInstaller().Run(context.Background(), InstallDisabled); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(paths.ReleaseRoot, "unmanaged"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := newInstaller().Run(context.Background(), VerifyDisabled); err == nil {
		t.Fatal("unknown release artifact was accepted")
	}
}

func TestRejectsActivationActions(t *testing.T) {
	installer := New(Config{BundleRoot: t.TempDir()})
	for _, action := range []Action{"install", "enable", "start", "restart", "repair", "adopt", "force"} {
		if err := installer.Run(context.Background(), action); err == nil {
			t.Fatalf("action %q was accepted", action)
		}
	}
}

func createBundle(t *testing.T, root, version string) string {
	t.Helper()
	for _, directory := range []string{"application/dist", "application/node_modules/runtime", "systemd", "config"} {
		if err := os.MkdirAll(filepath.Join(root, directory), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string]struct {
		content string
		mode    os.FileMode
	}{
		"application/dist/main.js":                  {"console.log('smoke');\n", 0o644},
		"application/package.json":                  {`{"name":"atlas-manager","version":"0.1.0","type":"module"}`, 0o644},
		"application/package-lock.json":             {`{"name":"atlas-manager","lockfileVersion":3,"requires":true,"packages":{}}`, 0o644},
		"application/node_modules/runtime/index.js": {"export {};\n", 0o644},
		"atlas-manager-installer":                   {"test installer\n", 0o755},
		"atlas-manager-server-installer":            {"test server installer\n", 0o755},
		"atlas-manager-host-qualification":          {"test qualification\n", 0o755},
		"atlas-manager-runtime-identity-installer":  {"test identity installer\n", 0o755},
		"atlas-manager-runtime-configuration":       {"test runtime configuration\n", 0o755},
		"atlas-manager-service-lifecycle":           {"test service lifecycle\n", 0o755},
		"systemd/atlas-manager.service":             {systemdunit.Content, 0o644},
		"config/atlas-manager.env.example":          {"HOST=127.0.0.1\nPOWER_MANAGEMENT_BACKEND=mock\n", 0o640},
		"INSTALLATION.md":                           {"disabled\n", 0o644},
		"LICENSE":                                   {"MIT\n", 0o644},
	}
	for path, file := range files {
		if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(path)), []byte(file.content), file.mode); err != nil {
			t.Fatal(err)
		}
	}
	paths, err := manifest.Files(root)
	if err != nil {
		t.Fatal(err)
	}
	filesForManifest, err := manifest.Inventory(root, paths)
	if err != nil {
		t.Fatal(err)
	}
	sort.Slice(filesForManifest, func(left, right int) bool { return filesForManifest[left].Path < filesForManifest[right].Path })
	value := manifest.Manifest{SchemaVersion: 1, Name: "atlas-manager", Version: version, SourceCommit: "0123456789abcdef0123456789abcdef01234567", Target: manifest.Target{OS: "linux", Arch: "amd64"}, NodeVersion: "24.18.0", NPMVersion: "11.16.0", GoVersion: "1.23.0", RuntimeNodePath: "/usr/bin/node", SystemdUnitPath: "/etc/systemd/system/atlas-manager.service", Files: filesForManifest}
	data, err := manifest.Encode(value)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "MANIFEST.json"), append(data, '\n'), 0o644); err != nil {
		t.Fatal(err)
	}
	checksumPaths := append(append([]string{}, paths...), "MANIFEST.json")
	sort.Strings(checksumPaths)
	var checksums []byte
	for _, path := range checksumPaths {
		bytes, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(path)))
		if err != nil {
			t.Fatal(err)
		}
		digest := sha256.Sum256(bytes)
		checksums = append(checksums, []byte(hex.EncodeToString(digest[:])+"  "+path+"\n")...)
	}
	if err := os.WriteFile(filepath.Join(root, "SHA256SUMS"), checksums, 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func sandboxPaths(root string) Paths {
	return Paths{ReleaseRoot: filepath.Join(root, "opt/atlas-manager/releases"), Current: filepath.Join(root, "opt/atlas-manager/current"), Unit: filepath.Join(root, "etc/systemd/system/atlas-manager.service"), ConfigDir: filepath.Join(root, "etc/atlas-manager"), Template: filepath.Join(root, "etc/atlas-manager/atlas-manager.env.example"), Environment: filepath.Join(root, "etc/atlas-manager/atlas-manager.env"), StateHome: filepath.Join(root, "var/lib/atlas-manager-deployment"), StateFile: filepath.Join(root, "var/lib/atlas-manager-deployment/state.json"), Lock: filepath.Join(root, "run/atlas-manager-deployment.lock"), RuntimeDir: filepath.Join(root, "run/atlas-manager"), EnableLink: filepath.Join(root, "etc/systemd/system/multi-user.target.wants/atlas-manager.service"), Node: "/usr/bin/node"}
}
