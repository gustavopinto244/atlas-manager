package rtc

import (
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
)

const (
	MaxAttributeBytes = 128
	MaxRTCClockSkew   = 300 * time.Second
)

var (
	ErrUnsupported       = errors.New("rtc unsupported")
	ErrStateUnavailable  = errors.New("rtc state unavailable")
	ErrWakeAlarmAbsent   = errors.New("rtc wake alarm absent")
	ErrAttributeTooLarge = errors.New("rtc attribute too large")
)

type FileSystem interface {
	CheckSysfs() error
	ReadSinceEpoch() ([]byte, error)
	ReadWakeAlarm() ([]byte, error)
}

type Clock interface {
	Now() time.Time
}

type SystemClock struct{}

func (SystemClock) Now() time.Time {
	return time.Now().UTC()
}

type WakeAlarm struct {
	State        string
	ScheduledFor string
}

type Information struct {
	RTCTime   string
	WakeAlarm WakeAlarm
}

type Reader struct {
	fileSystem FileSystem
	clock      Clock
}

func NewReader(fileSystem FileSystem, clock Clock) Reader {
	return Reader{fileSystem: fileSystem, clock: clock}
}

func (reader Reader) ReadRTCInformation() (Information, error) {
	rtcTime, err := reader.readRTC()
	if err != nil {
		return Information{}, err
	}
	wakeAlarm, err := reader.readWakeAlarm()
	if err != nil {
		return Information{}, err
	}
	return Information{RTCTime: rtcTime, WakeAlarm: wakeAlarm}, nil
}

func (reader Reader) ReadWakeAlarm() (WakeAlarm, error) {
	if _, err := reader.readRTC(); err != nil {
		return WakeAlarm{}, err
	}
	return reader.readWakeAlarm()
}

func (reader Reader) readRTC() (string, error) {
	if err := reader.fileSystem.CheckSysfs(); err != nil {
		return "", ErrUnsupported
	}

	systemBefore := reader.clock.Now().UTC()
	raw, readErr := reader.fileSystem.ReadSinceEpoch()
	systemAfter := reader.clock.Now().UTC()
	if readErr != nil {
		if errors.Is(readErr, ErrUnsupported) {
			return "", ErrUnsupported
		}
		return "", ErrStateUnavailable
	}

	seconds, ok := parseAttributeInteger(raw, false)
	if !ok {
		return "", ErrStateUnavailable
	}
	rtcTime, ok := epochSecondsToTimestamp(seconds)
	if !ok {
		return "", ErrStateUnavailable
	}
	parsedRTC, err := time.Parse(protocolTimestampLayout, rtcTime)
	if err != nil || parsedRTC.Before(systemBefore.Add(-MaxRTCClockSkew)) || parsedRTC.After(systemAfter.Add(MaxRTCClockSkew)) {
		return "", ErrStateUnavailable
	}
	return rtcTime, nil
}

func (reader Reader) readWakeAlarm() (WakeAlarm, error) {
	raw, err := reader.fileSystem.ReadWakeAlarm()
	if err != nil {
		if errors.Is(err, ErrWakeAlarmAbsent) {
			return WakeAlarm{State: protocol.WakeAlarmUnsupported}, nil
		}
		return WakeAlarm{}, ErrStateUnavailable
	}
	if len(raw) == 0 || string(raw) == "\n" {
		return WakeAlarm{State: protocol.WakeAlarmNotScheduled}, nil
	}
	seconds, ok := parseAttributeInteger(raw, false)
	if !ok || seconds == 0 {
		return WakeAlarm{}, ErrStateUnavailable
	}
	scheduledFor, ok := epochSecondsToTimestamp(seconds)
	if !ok {
		return WakeAlarm{}, ErrStateUnavailable
	}
	return WakeAlarm{State: protocol.WakeAlarmScheduled, ScheduledFor: scheduledFor}, nil
}

const protocolTimestampLayout = "2006-01-02T15:04:05.000Z"

func parseAttributeInteger(raw []byte, allowEmpty bool) (uint64, bool) {
	if len(raw) > MaxAttributeBytes || !utf8.Valid(raw) {
		return 0, false
	}
	if strings.ContainsRune(string(raw), '\x00') || strings.ContainsRune(string(raw), '\r') {
		return 0, false
	}
	if len(raw) == 0 {
		return 0, allowEmpty
	}
	if raw[len(raw)-1] != '\n' || strings.Count(string(raw), "\n") != 1 {
		return 0, false
	}
	value := string(raw[:len(raw)-1])
	if value == "" || strings.TrimSpace(value) != value || (len(value) > 1 && value[0] == '0') {
		return 0, false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return 0, false
		}
	}
	seconds, err := strconv.ParseUint(value, 10, 64)
	return seconds, err == nil
}

func epochSecondsToTimestamp(seconds uint64) (string, bool) {
	if seconds > uint64(^uint64(0)>>1) {
		return "", false
	}
	value := time.Unix(int64(seconds), 0).UTC().Format(protocolTimestampLayout)
	if len(value) != len(protocolTimestampLayout) {
		return "", false
	}
	parsed, err := time.Parse(protocolTimestampLayout, value)
	return value, err == nil && parsed.UTC().Format(protocolTimestampLayout) == value && protocol.IsCanonicalTimestamp(value)
}
