package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	Version                 = 1
	MaxRequestBytes         = 4096
	MaxResponseBytes        = 16384
	InvalidInputExitCode    = 64
	InternalFailureExitCode = 70
)

type Operation string

const (
	ReadRTCInformation Operation = "read_rtc_information"
	ReadWakeAlarm      Operation = "read_wake_alarm"
	ScheduleWakeAlarm  Operation = "schedule_wake_alarm"
	CancelWakeAlarm    Operation = "cancel_wake_alarm"
	RequestShutdown    Operation = "request_shutdown"
)

var operations = map[Operation]struct{}{
	ReadRTCInformation: {},
	ReadWakeAlarm:      {},
	ScheduleWakeAlarm:  {},
	CancelWakeAlarm:    {},
	RequestShutdown:    {},
}

type Request struct {
	Version      int
	Operation    Operation
	RequestedAt  string
	ScheduledFor string
}

func (r Request) HasSchedule() bool {
	return r.Operation == ScheduleWakeAlarm
}

type Response struct {
	Version   int       `json:"version"`
	Operation Operation `json:"operation"`
	Outcome   string    `json:"outcome"`
	Code      string    `json:"code"`
}

var (
	ErrInvalidInput     = errors.New("invalid helper input")
	ErrResponseTooLarge = errors.New("helper response too large")
)

func ParseRequestLine(input []byte) (Request, error) {
	if len(input) == 0 || len(input) > MaxRequestBytes {
		return Request{}, ErrInvalidInput
	}
	if !utf8.Valid(input) || input[len(input)-1] != '\n' || bytes.Contains(input, []byte{'\r'}) {
		return Request{}, ErrInvalidInput
	}
	if bytes.Count(input, []byte{'\n'}) != 1 {
		return Request{}, ErrInvalidInput
	}
	line := input[:len(input)-1]
	if len(line) == 0 || len(bytes.TrimSpace(line)) != len(line) {
		return Request{}, ErrInvalidInput
	}

	fields, err := decodeStrictObject(line)
	if err != nil {
		return Request{}, ErrInvalidInput
	}
	version, ok := exactInteger(fields["version"])
	if !ok || version != Version {
		return Request{}, ErrInvalidInput
	}
	operationValue, ok := exactString(fields["operation"])
	if !ok {
		return Request{}, ErrInvalidInput
	}
	operation := Operation(operationValue)
	if _, ok := operations[operation]; !ok {
		return Request{}, ErrInvalidInput
	}
	requestedAt, ok := exactString(fields["requestedAt"])
	if !ok || !IsCanonicalTimestamp(requestedAt) {
		return Request{}, ErrInvalidInput
	}

	expected := map[string]struct{}{
		"version": {}, "operation": {}, "requestedAt": {},
	}
	if operation == ScheduleWakeAlarm {
		expected["scheduledFor"] = struct{}{}
	}
	if !hasExactKeys(fields, expected) {
		return Request{}, ErrInvalidInput
	}

	request := Request{Version: Version, Operation: operation, RequestedAt: requestedAt}
	if operation == ScheduleWakeAlarm {
		scheduledFor, ok := exactString(fields["scheduledFor"])
		if !ok || !IsCanonicalTimestamp(scheduledFor) || scheduledFor <= requestedAt {
			return Request{}, ErrInvalidInput
		}
		request.ScheduledFor = scheduledFor
	}
	return request, nil
}

func RejectingResponse(request Request) Response {
	return Response{Version: Version, Operation: request.Operation, Outcome: "rejected", Code: "operation_unsupported"}
}

func MarshalResponse(response Response) ([]byte, error) {
	encoded, err := json.Marshal(response)
	if err != nil {
		return nil, ErrResponseTooLarge
	}
	encoded = append(encoded, '\n')
	if len(encoded) > MaxResponseBytes {
		return nil, ErrResponseTooLarge
	}
	return encoded, nil
}

func IsCanonicalTimestamp(value string) bool {
	if len(value) != len("2006-01-02T15:04:05.000Z") || !strings.HasSuffix(value, "Z") {
		return false
	}
	parsed, err := time.Parse("2006-01-02T15:04:05.000Z", value)
	return err == nil && parsed.UTC().Format("2006-01-02T15:04:05.000Z") == value
}

func exactInteger(raw json.RawMessage) (int, bool) {
	_, ok := exactStringBytes(raw)
	if ok {
		return 0, false
	}
	parsed, err := strconv.Atoi(string(raw))
	return parsed, err == nil && string(raw) == strconv.Itoa(parsed)
}

func exactString(raw json.RawMessage) (string, bool) {
	var value string
	if len(raw) == 0 || json.Unmarshal(raw, &value) != nil {
		return "", false
	}
	return value, true
}

func exactStringBytes(raw json.RawMessage) (string, bool) {
	if len(raw) > 0 && raw[0] == '"' {
		value, ok := exactString(raw)
		return value, ok
	}
	return "", false
}

func hasExactKeys(fields map[string]json.RawMessage, expected map[string]struct{}) bool {
	if len(fields) != len(expected) {
		return false
	}
	for field := range fields {
		if _, ok := expected[field]; !ok {
			return false
		}
	}
	return true
}

func decodeStrictObject(input []byte) (map[string]json.RawMessage, error) {
	decoder := json.NewDecoder(bytes.NewReader(input))
	decoder.UseNumber()
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return nil, ErrInvalidInput
	}
	fields := make(map[string]json.RawMessage)
	for decoder.More() {
		keyToken, err := decoder.Token()
		key, ok := keyToken.(string)
		if err != nil || !ok {
			return nil, ErrInvalidInput
		}
		if _, exists := fields[key]; exists {
			return nil, ErrInvalidInput
		}
		var raw json.RawMessage
		if decoder.Decode(&raw) != nil {
			return nil, ErrInvalidInput
		}
		fields[key] = raw
	}
	if token, err = decoder.Token(); err != nil || token != json.Delim('}') {
		return nil, ErrInvalidInput
	}
	var extra json.RawMessage
	if err = decoder.Decode(&extra); err != io.EOF {
		return nil, ErrInvalidInput
	}
	return fields, nil
}
