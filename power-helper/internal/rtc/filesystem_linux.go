//go:build linux

package rtc

import (
	"errors"
	"io"
	"os"
	"syscall"
)

const (
	SYS_ROOT        = "/sys"
	RTC_ROOT        = "/sys/class/rtc/rtc0"
	RTC_SINCE_EPOCH = "/sys/class/rtc/rtc0/since_epoch"
	RTC_WAKE_ALARM  = "/sys/class/rtc/rtc0/wakealarm"
	SYSFS_MAGIC     = 0x62656572
)

type LinuxFileSystem struct{}

func (LinuxFileSystem) CheckSysfs() error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(SYS_ROOT, &stat); err != nil || uint64(stat.Type) != SYSFS_MAGIC {
		return ErrUnsupported
	}
	return nil
}

func (LinuxFileSystem) ReadSinceEpoch() ([]byte, error) {
	value, err := readFixedAttribute(RTC_SINCE_EPOCH)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrUnsupported
	}
	return value, err
}

func (LinuxFileSystem) ReadWakeAlarm() ([]byte, error) {
	value, err := readFixedAttribute(RTC_WAKE_ALARM)
	if errors.Is(err, os.ErrNotExist) {
		return nil, ErrWakeAlarmAbsent
	}
	return value, err
}

func readFixedAttribute(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	value, err := readBounded(file)
	if err != nil {
		return nil, err
	}
	return value, nil
}

func readBounded(reader io.Reader) ([]byte, error) {
	value, err := io.ReadAll(io.LimitReader(reader, MaxAttributeBytes+1))
	if err != nil {
		return nil, err
	}
	if len(value) > MaxAttributeBytes {
		return nil, ErrAttributeTooLarge
	}
	return value, nil
}
