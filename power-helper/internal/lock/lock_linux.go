//go:build linux

package lock

import (
	"errors"
	"os"
	"sync"
	"syscall"
)

const LockPath = "/run/atlas-manager-power-helper.lock"

var ErrUnavailable = errors.New("operation lock unavailable")

type Release func()

type OperationLock interface {
	AcquireShared() (Release, error)
	AcquireExclusive() (Release, error)
}

type FileLock struct {
	path string
}

func NewFixedFileLock() OperationLock {
	return FileLock{path: LockPath}
}

func (fileLock FileLock) AcquireShared() (Release, error) {
	return fileLock.acquire(syscall.LOCK_SH)
}

func (fileLock FileLock) AcquireExclusive() (Release, error) {
	return fileLock.acquire(syscall.LOCK_EX)
}

func (fileLock FileLock) acquire(mode int) (Release, error) {
	file, err := openAndValidate(fileLock.path)
	if err != nil {
		return nil, ErrUnavailable
	}
	if err := syscall.Flock(int(file.Fd()), mode|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		return nil, ErrUnavailable
	}

	var once sync.Once
	return func() {
		once.Do(func() {
			_ = syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
			_ = file.Close()
		})
	}, nil
}

func openAndValidate(path string) (*os.File, error) {
	fd, err := syscall.Open(path, syscall.O_RDWR|syscall.O_CREAT|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, ErrUnavailable
	}
	file := os.NewFile(uintptr(fd), path)
	if file == nil {
		_ = syscall.Close(fd)
		return nil, ErrUnavailable
	}

	var stat syscall.Stat_t
	if err := syscall.Fstat(fd, &stat); err != nil || !validLockStat(stat) {
		_ = file.Close()
		return nil, ErrUnavailable
	}
	return file, nil
}

func validLockStat(stat syscall.Stat_t) bool {
	return stat.Mode&syscall.S_IFMT == syscall.S_IFREG &&
		stat.Uid == 0 &&
		stat.Mode&07777 == 0600 &&
		stat.Nlink == 1
}
