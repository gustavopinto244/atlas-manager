//go:build linux

package lock

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestFixedLockPathAndValidStat(t *testing.T) {
	if LockPath != "/run/atlas-manager-power-helper.lock" {
		t.Fatal("lock path changed")
	}
	valid := syscall.Stat_t{Mode: syscall.S_IFREG | 0600, Uid: 0, Nlink: 1}
	if !validLockStat(valid) {
		t.Fatal("valid lock state rejected")
	}
}

func TestFileLockRejectsFinalComponentSymlink(t *testing.T) {
	directory := t.TempDir()
	target := filepath.Join(directory, "target")
	link := filepath.Join(directory, "lock")
	if err := os.WriteFile(target, []byte{}, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := (FileLock{path: link}).AcquireShared(); err == nil {
		t.Fatal("final-component symlink was accepted")
	}
}

func TestUnsafeLockStatesReject(t *testing.T) {
	valid := syscall.Stat_t{Mode: syscall.S_IFREG | 0600, Uid: 0, Nlink: 1}
	cases := map[string]syscall.Stat_t{
		"directory":      {Mode: syscall.S_IFDIR | 0600, Uid: 0, Nlink: 1},
		"non-root":       {Mode: syscall.S_IFREG | 0600, Uid: 1000, Nlink: 1},
		"unsafe mode":    {Mode: syscall.S_IFREG | 0660, Uid: 0, Nlink: 1},
		"multiple links": {Mode: syscall.S_IFREG | 0600, Uid: 0, Nlink: 2},
		"setuid":         {Mode: syscall.S_IFREG | 04600, Uid: 0, Nlink: 1},
	}
	if !validLockStat(valid) {
		t.Fatal("test valid state is invalid")
	}
	for name, state := range cases {
		t.Run(name, func(t *testing.T) {
			if validLockStat(state) {
				t.Fatal("unsafe lock state accepted")
			}
		})
	}
}
