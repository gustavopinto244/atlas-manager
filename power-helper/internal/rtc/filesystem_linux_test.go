//go:build linux

package rtc

import (
	"errors"
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

func TestWritePayloadRequiresOneCompleteBoundedWrite(t *testing.T) {
	payload := []byte("1785661200\n")
	writes := 0
	if err := writePayload(payload, func(value []byte) (int, error) {
		writes++
		if string(value) != string(payload) {
			t.Fatal("payload changed")
		}
		return len(value), nil
	}); err != nil || writes != 1 {
		t.Fatalf("valid write failed: %v, writes=%d", err, writes)
	}
	for name, write := range map[string]func([]byte) (int, error){
		"short": func(value []byte) (int, error) { return len(value) - 1, nil },
		"error": func([]byte) (int, error) { return 0, errors.New("write failed") },
	} {
		t.Run(name, func(t *testing.T) {
			if err := writePayload(payload, write); !errors.Is(err, ErrOperationFailed) {
				t.Fatalf("got %v, want operation failure", err)
			}
		})
	}
	if err := writePayload([]byte(strings.Repeat("x", MaxWriteBytes+1)), func([]byte) (int, error) { t.Fatal("writer called"); return 0, nil }); !errors.Is(err, ErrOperationFailed) {
		t.Fatalf("oversized payload returned %v", err)
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
