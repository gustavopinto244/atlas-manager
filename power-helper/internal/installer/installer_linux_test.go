//go:build linux

package installer

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/bundle"
)

func TestSandboxInstallVerifyUninstallDoesNotUseProductionPaths(t *testing.T) {
	root := t.TempDir()
	paths := SandboxPaths(root)
	for _, path := range []string{paths.Usr, paths.UsrLocal, filepath.Dir(paths.GroupFile), filepath.Dir(paths.StateDir)} {
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	gid := uint32(os.Getegid())
	if gid == 0 {
		t.Skip("ordinary-user sandbox requires a nonzero test group")
	}
	if err := os.WriteFile(paths.GroupFile, []byte(fmt.Sprintf("root:x:0:\natlas-manager-power:x:%d:\n", gid)), 0644); err != nil {
		t.Fatal(err)
	}
	bundleRoot := filepath.Join(root, "bundle", "atlas-manager-power-helper_0.1.0_linux_amd64")
	helper, installerPayload := []byte("helper payload"), []byte("installer payload")
	manifest := bundle.BuildManifest("0.1.0", "df23dc5ecdeb1ea65f020331c6281cb3776d8d34", "1.23.0", 0, helper, installerPayload)
	if err := bundle.CreateDirectoryBundle(bundleRoot, manifest, helper, installerPayload, []byte("runbook\n")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(paths.Libexec, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(paths.Libexec, ".atlas-manager-power-helper.candidate"), []byte("stale"), 0750); err != nil {
		t.Fatal(err)
	}
	instance := NewSandbox(paths, bundleRoot)
	if status, err := instance.Run("install"); err != nil || status != StatusValid {
		t.Fatalf("install: status=%s err=%v", status, err)
	}
	if status, err := instance.Run("verify"); err != nil || status != StatusValid {
		t.Fatalf("verify: status=%s err=%v", status, err)
	}
	if err := os.Remove(paths.StateFile); err != nil {
		t.Fatal(err)
	}
	if status, err := instance.Run("install"); err != nil || status != StatusValid {
		t.Fatalf("state reconciliation: status=%s err=%v", status, err)
	}
	info, err := os.Lstat(paths.HelperPath)
	if err != nil {
		t.Fatal(err)
	}
	if !hasExactMode(info, 04750) {
		t.Fatalf("unexpected installed mode")
	}
	if status, err := instance.Run("uninstall"); err != nil || status != StatusNotInstalled {
		t.Fatalf("uninstall: status=%s err=%v", status, err)
	}
	if _, err := os.Lstat(paths.HelperPath); !os.IsNotExist(err) {
		t.Fatalf("helper remains after uninstall: %v", err)
	}
	if _, err := os.Stat("/usr/local/libexec/atlas-manager-power-helper"); err == nil {
		t.Fatal("test unexpectedly touched production helper")
	}
}

func TestInstallerRejectsExactActionAndGroupState(t *testing.T) {
	root := t.TempDir()
	paths := SandboxPaths(root)
	for _, path := range []string{paths.Usr, paths.UsrLocal, filepath.Dir(paths.GroupFile), filepath.Dir(paths.StateDir)} {
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	gid := uint32(os.Getegid())
	if gid == 0 {
		t.Skip("ordinary-user sandbox requires a nonzero test group")
	}
	if err := os.WriteFile(paths.GroupFile, []byte(fmt.Sprintf("atlas-manager-power:x:%d:atlas\n", gid)), 0644); err != nil {
		t.Fatal(err)
	}
	instance := NewSandbox(paths, filepath.Join(root, "missing-bundle"))
	if status, err := instance.Run("inspect-bundle"); err == nil || status != StatusBundleInvalid {
		t.Fatalf("invalid bundle status=%s err=%v", status, err)
	}
	if status, err := instance.Run("unknown"); err == nil || status != StatusInstallationInvalid {
		t.Fatalf("invalid action status=%s err=%v", status, err)
	}
	validBundle := filepath.Join(root, "bundle")
	helper, installerPayload := []byte("helper"), []byte("installer")
	manifest := bundle.BuildManifest("0.1.0", "df23dc5ecdeb1ea65f020331c6281cb3776d8d34", "1.23.0", 0, helper, installerPayload)
	if err := bundle.CreateDirectoryBundle(validBundle, manifest, helper, installerPayload, nil); err != nil {
		t.Fatal(err)
	}
	instance = NewSandbox(paths, validBundle)
	if status, err := instance.Run("verify"); err == nil || status != StatusGroupNotEmpty {
		t.Fatalf("nonempty group status=%s err=%v", status, err)
	}
}

func TestUnsafeExistingTargetIsNotAdopted(t *testing.T) {
	root := t.TempDir()
	paths := SandboxPaths(root)
	for _, path := range []string{paths.Usr, paths.UsrLocal, filepath.Dir(paths.GroupFile), filepath.Dir(paths.StateDir)} {
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	gid := uint32(os.Getegid())
	if gid == 0 {
		t.Skip("ordinary-user sandbox requires a nonzero test group")
	}
	if err := os.WriteFile(paths.GroupFile, []byte(fmt.Sprintf("atlas-manager-power:x:%d:\n", gid)), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(paths.Libexec, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.HelperPath, []byte("unmanaged"), 0750); err != nil {
		t.Fatal(err)
	}
	bundleRoot := filepath.Join(root, "bundle")
	helper, installerPayload := []byte("helper"), []byte("installer")
	manifest := bundle.BuildManifest("0.1.0", "df23dc5ecdeb1ea65f020331c6281cb3776d8d34", "1.23.0", 0, helper, installerPayload)
	if err := bundle.CreateDirectoryBundle(bundleRoot, manifest, helper, installerPayload, nil); err != nil {
		t.Fatal(err)
	}
	if status, err := NewSandbox(paths, bundleRoot).Run("install"); err == nil || status != StatusInstallationInvalid {
		t.Fatalf("unmanaged target status=%s err=%v", status, err)
	}
	contents, err := os.ReadFile(paths.HelperPath)
	if err != nil || string(contents) != "unmanaged" {
		t.Fatalf("unmanaged target changed: %q %v", contents, err)
	}
}

func TestFixedLockRejectsUnsafeMetadata(t *testing.T) {
	root := t.TempDir()
	paths := SandboxPaths(root)
	if err := os.MkdirAll(filepath.Dir(paths.LockFile), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(paths.LockFile, []byte{}, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(paths.LockFile, 0640); err != nil {
		t.Fatal(err)
	}
	instance := NewSandbox(paths, "unused")
	if _, err := instance.acquireInstallLock(false); err == nil {
		t.Fatal("unsafe lock was accepted")
	}
}
