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
	MaxWriteBytes     = 32
)

var (
	ErrUnsupported       = errors.New("rtc unsupported")
	ErrStateUnavailable  = errors.New("rtc state unavailable")
	ErrWakeAlarmAbsent   = errors.New("rtc wake alarm absent")
	ErrAttributeTooLarge = errors.New("rtc attribute too large")
	ErrOperationRejected = errors.New("rtc operation rejected")
	ErrOperationFailed   = errors.New("rtc operation failed")
)

type FileSystem interface {
	CheckSysfs() error
	ReadSinceEpoch() ([]byte, error)
	ReadWakeAlarm() ([]byte, error)
	WriteWakeAlarm([]byte) error
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
	rtcTime, wakeAlarm, err := reader.readRTCAndWakeAlarm()
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

func (reader Reader) readRTCAndWakeAlarm() (string, WakeAlarm, error) {
	rtcTime, err := reader.readRTC()
	if err != nil {
		return "", WakeAlarm{}, err
	}
	wakeAlarm, err := reader.readWakeAlarm()
	if err != nil {
		return "", WakeAlarm{}, err
	}
	return rtcTime, wakeAlarm, nil
}

type Mutator struct {
	reader Reader
}

func NewMutator(fileSystem FileSystem, clock Clock) Mutator {
	return Mutator{reader: NewReader(fileSystem, clock)}
}

type Mutation struct {
	Before  WakeAlarm
	After   WakeAlarm
	Outcome string
}

func (mutator Mutator) Schedule(scheduledFor string) (Mutation, error) {
	rtcTime, err := mutator.reader.readRTC()
	if err != nil {
		return Mutation{}, err
	}
	requested, ok := parseCanonicalTimestamp(scheduledFor)
	if !ok || !requested.After(parseRequiredTimestamp(rtcTime)) {
		return Mutation{}, ErrOperationRejected
	}
	before, err := mutator.reader.readWakeAlarm()
	if err != nil {
		return Mutation{}, err
	}
	if before.State == protocol.WakeAlarmUnsupported {
		return Mutation{}, ErrUnsupported
	}
	after := WakeAlarm{State: protocol.WakeAlarmScheduled, ScheduledFor: scheduledFor}
	if before.State == protocol.WakeAlarmScheduled && before.ScheduledFor == scheduledFor {
		return Mutation{Before: before, After: before, Outcome: "unchanged"}, nil
	}
	if before.State == protocol.WakeAlarmNotScheduled {
		if err := mutator.writeAndVerify(after); err != nil {
			return Mutation{}, err
		}
		return Mutation{Before: before, After: after, Outcome: "scheduled"}, nil
	}
	if err := mutator.writeAndVerify(WakeAlarm{State: protocol.WakeAlarmNotScheduled}); err != nil {
		return Mutation{}, err
	}
	if err := mutator.writeAndVerify(after); err != nil {
		return Mutation{}, err
	}
	return Mutation{Before: before, After: after, Outcome: "replaced"}, nil
}

func (mutator Mutator) Cancel() (Mutation, error) {
	if _, err := mutator.reader.readRTC(); err != nil {
		return Mutation{}, err
	}
	before, err := mutator.reader.readWakeAlarm()
	if err != nil {
		return Mutation{}, err
	}
	if before.State == protocol.WakeAlarmUnsupported {
		return Mutation{}, ErrUnsupported
	}
	if before.State == protocol.WakeAlarmNotScheduled {
		return Mutation{Before: before, After: before, Outcome: "not_scheduled"}, nil
	}
	if err := mutator.writeAndVerify(WakeAlarm{State: protocol.WakeAlarmNotScheduled}); err != nil {
		return Mutation{}, err
	}
	return Mutation{Before: before, After: WakeAlarm{State: protocol.WakeAlarmNotScheduled}, Outcome: "cancelled"}, nil
}

func (mutator Mutator) writeAndVerify(expected WakeAlarm) error {
	payload := []byte("0\n")
	if expected.State == protocol.WakeAlarmScheduled {
		var ok bool
		payload, ok = epochPayload(expected.ScheduledFor)
		if !ok {
			return ErrOperationRejected
		}
	}
	if len(payload) > MaxWriteBytes {
		return ErrOperationFailed
	}
	if err := mutator.reader.fileSystem.WriteWakeAlarm(payload); err != nil {
		return ErrOperationFailed
	}
	observed, err := mutator.reader.readWakeAlarm()
	if err != nil || observed.State != expected.State || (expected.State == protocol.WakeAlarmScheduled && observed.ScheduledFor != expected.ScheduledFor) {
		return ErrOperationFailed
	}
	return nil
}

func parseCanonicalTimestamp(value string) (time.Time, bool) {
	if !protocol.IsCanonicalTimestamp(value) {
		return time.Time{}, false
	}
	parsed, err := time.Parse(protocolTimestampLayout, value)
	return parsed.UTC(), err == nil
}

func parseRequiredTimestamp(value string) time.Time {
	parsed, _ := parseCanonicalTimestamp(value)
	return parsed
}

func epochPayload(value string) ([]byte, bool) {
	parsed, ok := parseCanonicalTimestamp(value)
	if !ok {
		return nil, false
	}
	payload := []byte(strconv.FormatInt(parsed.Unix(), 10) + "\n")
	return payload, len(payload) <= MaxWriteBytes
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
