package rtc

import (
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
)

type fakeFileSystem struct {
	checkErr        error
	sinceEpoch      []byte
	sinceEpochErr   error
	wakeAlarm       []byte
	wakeAlarmErr    error
	checkCalls      int
	sinceEpochCalls int
	wakeAlarmCalls  int
}

func (filesystem *fakeFileSystem) CheckSysfs() error {
	filesystem.checkCalls++
	return filesystem.checkErr
}

func (filesystem *fakeFileSystem) ReadSinceEpoch() ([]byte, error) {
	filesystem.sinceEpochCalls++
	return filesystem.sinceEpoch, filesystem.sinceEpochErr
}

func (filesystem *fakeFileSystem) ReadWakeAlarm() ([]byte, error) {
	filesystem.wakeAlarmCalls++
	return filesystem.wakeAlarm, filesystem.wakeAlarmErr
}

type fakeClock struct {
	times []time.Time
	index int
}

func (clock *fakeClock) Now() time.Time {
	value := clock.times[clock.index]
	clock.index++
	return value
}

func TestReaderReturnsRTCAndScheduledWakeAlarm(t *testing.T) {
	const rtcTimestamp = "2026-08-01T18:00:00.000Z"
	const wakeTimestamp = "2026-08-02T09:00:00.000Z"
	rtcEpoch := time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC).Unix()
	wakeEpoch := time.Date(2026, 8, 2, 9, 0, 0, 0, time.UTC).Unix()
	filesystem := &fakeFileSystem{sinceEpoch: []byte(strconv.FormatInt(rtcEpoch, 10) + "\n"), wakeAlarm: []byte(strconv.FormatInt(wakeEpoch, 10) + "\n")}
	clock := &fakeClock{times: []time.Time{
		time.Date(2026, 8, 1, 17, 59, 59, 0, time.UTC),
		time.Date(2026, 8, 1, 18, 0, 1, 0, time.UTC),
	}}
	reader := NewReader(filesystem, clock)

	information, err := reader.ReadRTCInformation()
	if err != nil {
		t.Fatal(err)
	}
	if information.RTCTime != rtcTimestamp || information.WakeAlarm.State != "scheduled" || information.WakeAlarm.ScheduledFor != wakeTimestamp {
		t.Fatalf("unexpected information: %#v", information)
	}
	if filesystem.checkCalls != 1 || filesystem.sinceEpochCalls != 1 || filesystem.wakeAlarmCalls != 1 {
		t.Fatalf("unexpected filesystem calls: %#v", filesystem)
	}
}

func TestReaderMapsWakeAlarmStates(t *testing.T) {
	rtcEpoch := time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC).Unix()
	for name, wakeAlarm := range map[string][]byte{
		"unsupported":   nil,
		"not scheduled": []byte("\n"),
	} {
		t.Run(name, func(t *testing.T) {
			filesystem := &fakeFileSystem{sinceEpoch: []byte(strconv.FormatInt(rtcEpoch, 10) + "\n"), wakeAlarm: wakeAlarm}
			clock := &fakeClock{times: []time.Time{
				time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC),
				time.Date(2026, 8, 1, 18, 0, 1, 0, time.UTC),
			}}
			if name == "unsupported" {
				filesystem.wakeAlarmErr = ErrWakeAlarmAbsent
			}
			result, err := NewReader(filesystem, clock).ReadWakeAlarm()
			if err != nil {
				t.Fatal(err)
			}
			want := protocol.WakeAlarmNotScheduled
			if name == "unsupported" {
				want = "unsupported"
			}
			if result.State != want {
				t.Fatalf("unexpected state: %#v", result)
			}
		})
	}
}

func TestReaderFailsClosedForUnsupportedAndInvalidState(t *testing.T) {
	rtcEpoch := time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC).Unix()
	validSince := []byte(strconv.FormatInt(rtcEpoch, 10) + "\n")
	validClock := func() *fakeClock {
		return &fakeClock{times: []time.Time{
			time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC),
			time.Date(2026, 8, 1, 18, 0, 1, 0, time.UTC),
		}}
	}
	for name, filesystem := range map[string]*fakeFileSystem{
		"sysfs unavailable": {checkErr: ErrUnsupported},
		"rtc absent":        {sinceEpochErr: ErrUnsupported},
		"malformed epoch":   {sinceEpoch: []byte("01\n")},
		"malformed alarm":   {sinceEpoch: validSince, wakeAlarm: []byte("+1\n")},
	} {
		t.Run(name, func(t *testing.T) {
			if filesystem.sinceEpoch == nil && filesystem.sinceEpochErr == nil {
				filesystem.sinceEpoch = validSince
			}
			if filesystem.wakeAlarm == nil && filesystem.wakeAlarmErr == nil {
				filesystem.wakeAlarm = []byte("\n")
			}
			_, err := NewReader(filesystem, validClock()).ReadWakeAlarm()
			want := ErrStateUnavailable
			if name == "sysfs unavailable" || name == "rtc absent" {
				want = ErrUnsupported
			}
			if !errors.Is(err, want) {
				t.Fatalf("got %v, want %v", err, want)
			}
		})
	}
}

func TestReaderRejectsRTCOutsideSystemClockSkew(t *testing.T) {
	filesystem := &fakeFileSystem{sinceEpoch: []byte("1767225600\n"), wakeAlarm: []byte("\n")}
	clock := &fakeClock{times: []time.Time{
		time.Date(2026, 8, 1, 18, 0, 0, 0, time.UTC),
		time.Date(2026, 8, 1, 18, 0, 1, 0, time.UTC),
	}}
	_, err := NewReader(filesystem, clock).ReadWakeAlarm()
	if !errors.Is(err, ErrStateUnavailable) {
		t.Fatalf("got %v, want state unavailable", err)
	}
	if filesystem.wakeAlarmCalls != 0 {
		t.Fatal("wake alarm was read after skew rejection")
	}
}

func TestAttributeIntegerRules(t *testing.T) {
	for _, value := range [][]byte{
		[]byte("0\n"), []byte("1\n"), []byte("1767225600\n"),
	} {
		if _, ok := parseAttributeInteger(value, false); !ok {
			t.Fatalf("valid attribute rejected: %q", value)
		}
	}
	for _, value := range [][]byte{
		[]byte("01\n"), []byte("+1\n"), []byte("-1\n"), []byte("1.0\n"),
		[]byte("1\r\n"), []byte("1\n2\n"), []byte(" 1\n"), []byte("1 \n"),
		[]byte{0xff, '\n'}, []byte{'1', 0, '\n'},
	} {
		if _, ok := parseAttributeInteger(value, false); ok {
			t.Fatalf("invalid attribute accepted: %q", value)
		}
	}
}

func TestEpochTimestampBounds(t *testing.T) {
	for _, value := range []uint64{0, 253402300799} {
		if timestamp, ok := epochSecondsToTimestamp(value); !ok || timestamp == "" {
			t.Fatalf("representable epoch rejected: %d", value)
		}
	}
	if _, ok := epochSecondsToTimestamp(^uint64(0)); ok {
		t.Fatal("unrepresentable epoch accepted")
	}
}
