//go:build linux

package shutdown

import (
	"errors"
	"os"
	"syscall"
)

const (
	SystemBusSocketPath = "/run/dbus/system_bus_socket"
	SystemBusAddress    = "unix:path=/run/dbus/system_bus_socket"
	SystemBusDirectory  = "/run/dbus"
)

var (
	ErrSocketUnavailable = errors.New("system bus socket unavailable")
	ErrSocketUnsafe      = errors.New("system bus socket unsafe")
	ErrSocketInspection  = errors.New("system bus socket inspection failed")
)

type SystemBusSocketInspector interface {
	Inspect() error
}

type LinuxSystemBusSocketInspector struct{}

func (LinuxSystemBusSocketInspector) Inspect() error {
	parent, err := os.Lstat(SystemBusDirectory)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrSocketUnavailable
		}
		return ErrSocketInspection
	}
	if !validBusDirectory(parent) {
		return ErrSocketUnsafe
	}

	socket, err := os.Lstat(SystemBusSocketPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ErrSocketUnavailable
		}
		return ErrSocketInspection
	}
	if !validBusSocket(socket) {
		return ErrSocketUnsafe
	}
	return nil
}

func validBusDirectory(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode().IsDir() && stat.Uid == 0 && info.Mode().Perm()&0022 == 0
}

func validBusSocket(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && info.Mode()&os.ModeSocket != 0 && stat.Uid == 0
}
