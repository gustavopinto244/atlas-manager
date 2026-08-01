//go:build linux

package rtc

import (
	"strings"
	"testing"
)

func TestLinuxFileSystemUsesOnlyFixedRTCResources(t *testing.T) {
	if SYS_ROOT != "/sys" || RTC_ROOT != "/sys/class/rtc/rtc0" || RTC_SINCE_EPOCH != "/sys/class/rtc/rtc0/since_epoch" || RTC_WAKE_ALARM != "/sys/class/rtc/rtc0/wakealarm" {
		t.Fatal("RTC resource contract changed")
	}
	if SYSFS_MAGIC != 0x62656572 {
		t.Fatal("unexpected sysfs magic")
	}
}

func TestBoundedAttributeReadRejectsOversizedInput(t *testing.T) {
	if _, err := readBounded(strings.NewReader(strings.Repeat("x", MaxAttributeBytes+1))); err != ErrAttributeTooLarge {
		t.Fatalf("got %v, want oversized attribute error", err)
	}
	value, err := readBounded(strings.NewReader(strings.Repeat("x", MaxAttributeBytes)))
	if err != nil || len(value) != MaxAttributeBytes {
		t.Fatalf("boundary read failed: %d, %v", len(value), err)
	}
}
