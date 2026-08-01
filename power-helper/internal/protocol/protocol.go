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
	Version   int
	Operation Operation
	Outcome   string
	Code      string
	Result    *ResponseResult
}

type ResponseResult struct {
	RTCInformation *RTCInformationResult
	WakeAlarm      *WakeAlarmResult
	Mutation       *WakeAlarmMutationResult
	Shutdown       *ShutdownResult
}

type RTCInformationResult struct {
	RTCTime   string
	WakeAlarm WakeAlarmResult
}

type WakeAlarmResult struct {
	State        string `json:"state"`
	ScheduledFor string `json:"scheduledFor,omitempty"`
}

type WakeAlarmMutationResult struct {
	Before  WakeAlarmResult
	After   WakeAlarmResult
	Outcome string
}

type ShutdownResult struct {
	Accepted bool
}

const (
	WakeAlarmUnsupported  = "unsupported"
	WakeAlarmNotScheduled = "not_scheduled"
	WakeAlarmScheduled    = "scheduled"
)

var (
	ErrInvalidInput     = errors.New("invalid helper input")
	ErrInvalidResponse  = errors.New("invalid helper response")
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
	response, err := NewFailureResponse(request.Operation, "rejected", "operation_unsupported")
	if err != nil {
		return Response{}
	}
	return response
}

func NewFailureResponse(operation Operation, outcome string, code string) (Response, error) {
	response := Response{Version: Version, Operation: operation, Outcome: outcome, Code: code}
	if err := validateResponse(response); err != nil {
		return Response{}, err
	}
	return response, nil
}

func NewWakeAlarmResult(state string, scheduledFor string) (WakeAlarmResult, error) {
	result := WakeAlarmResult{State: state, ScheduledFor: scheduledFor}
	if err := validateWakeAlarmResult(result); err != nil {
		return WakeAlarmResult{}, err
	}
	return result, nil
}

func NewReadRTCInformationSuccess(rtcTime string, wakeAlarm WakeAlarmResult) (Response, error) {
	response := Response{
		Version:   Version,
		Operation: ReadRTCInformation,
		Outcome:   "success",
		Result:    &ResponseResult{RTCInformation: &RTCInformationResult{RTCTime: rtcTime, WakeAlarm: wakeAlarm}},
	}
	if err := validateResponse(response); err != nil {
		return Response{}, err
	}
	return response, nil
}

func NewReadWakeAlarmSuccess(wakeAlarm WakeAlarmResult) (Response, error) {
	response := Response{
		Version:   Version,
		Operation: ReadWakeAlarm,
		Outcome:   "success",
		Result:    &ResponseResult{WakeAlarm: &wakeAlarm},
	}
	if err := validateResponse(response); err != nil {
		return Response{}, err
	}
	return response, nil
}

func NewScheduleWakeAlarmSuccess(before WakeAlarmResult, after WakeAlarmResult, outcome string) (Response, error) {
	return newMutationSuccess(ScheduleWakeAlarm, before, after, outcome)
}

func NewCancelWakeAlarmSuccess(before WakeAlarmResult, after WakeAlarmResult, outcome string) (Response, error) {
	return newMutationSuccess(CancelWakeAlarm, before, after, outcome)
}

func NewRequestShutdownSuccess() (Response, error) {
	response := Response{
		Version:   Version,
		Operation: RequestShutdown,
		Outcome:   "success",
		Result:    &ResponseResult{Shutdown: &ShutdownResult{Accepted: true}},
	}
	if err := validateResponse(response); err != nil {
		return Response{}, err
	}
	return response, nil
}

func newMutationSuccess(operation Operation, before WakeAlarmResult, after WakeAlarmResult, outcome string) (Response, error) {
	response := Response{
		Version:   Version,
		Operation: operation,
		Outcome:   "success",
		Result:    &ResponseResult{Mutation: &WakeAlarmMutationResult{Before: before, After: after, Outcome: outcome}},
	}
	if err := validateResponse(response); err != nil {
		return Response{}, err
	}
	return response, nil
}

func MarshalResponse(response Response) ([]byte, error) {
	if err := validateResponse(response); err != nil {
		return nil, err
	}
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

func (r Response) MarshalJSON() ([]byte, error) {
	if err := validateResponse(r); err != nil {
		return nil, err
	}
	if r.Outcome == "success" {
		if r.Operation == ReadRTCInformation {
			return json.Marshal(struct {
				Version   int                      `json:"version"`
				Operation Operation                `json:"operation"`
				Outcome   string                   `json:"outcome"`
				Result    RTCInformationResultJSON `json:"result"`
			}{
				Version: r.Version, Operation: r.Operation, Outcome: r.Outcome,
				Result: RTCInformationResultJSON{
					RTCTime:   r.Result.RTCInformation.RTCTime,
					WakeAlarm: r.Result.RTCInformation.WakeAlarm,
				},
			})
		}
		if r.Operation == ScheduleWakeAlarm || r.Operation == CancelWakeAlarm {
			return json.Marshal(struct {
				Version   int                         `json:"version"`
				Operation Operation                   `json:"operation"`
				Outcome   string                      `json:"outcome"`
				Result    WakeAlarmMutationResultJSON `json:"result"`
			}{
				Version: r.Version, Operation: r.Operation, Outcome: r.Outcome,
				Result: WakeAlarmMutationResultJSON{
					Before:  r.Result.Mutation.Before,
					After:   r.Result.Mutation.After,
					Outcome: r.Result.Mutation.Outcome,
				},
			})
		}
		if r.Operation == RequestShutdown {
			return json.Marshal(struct {
				Version   int                `json:"version"`
				Operation Operation          `json:"operation"`
				Outcome   string             `json:"outcome"`
				Result    ShutdownResultJSON `json:"result"`
			}{
				Version: r.Version, Operation: r.Operation, Outcome: r.Outcome,
				Result: ShutdownResultJSON{Accepted: r.Result.Shutdown.Accepted},
			})
		}
		return json.Marshal(struct {
			Version   int             `json:"version"`
			Operation Operation       `json:"operation"`
			Outcome   string          `json:"outcome"`
			Result    WakeAlarmResult `json:"result"`
		}{
			Version: r.Version, Operation: r.Operation, Outcome: r.Outcome,
			Result: r.Result.WakeAlarmValue(),
		})
	}
	return json.Marshal(struct {
		Version   int       `json:"version"`
		Operation Operation `json:"operation"`
		Outcome   string    `json:"outcome"`
		Code      string    `json:"code"`
	}{Version: r.Version, Operation: r.Operation, Outcome: r.Outcome, Code: r.Code})
}

type RTCInformationResultJSON struct {
	RTCTime   string          `json:"rtcTime"`
	WakeAlarm WakeAlarmResult `json:"wakeAlarm"`
}

type WakeAlarmMutationResultJSON struct {
	Before  WakeAlarmResult `json:"before"`
	After   WakeAlarmResult `json:"after"`
	Outcome string          `json:"outcome"`
}

type ShutdownResultJSON struct {
	Accepted bool `json:"accepted"`
}

func (r *ResponseResult) WakeAlarmValue() WakeAlarmResult {
	if r == nil || r.WakeAlarm == nil {
		return WakeAlarmResult{}
	}
	return *r.WakeAlarm
}

func validateResponse(response Response) error {
	if response.Version != Version || !isKnownOperation(response.Operation) {
		return ErrInvalidResponse
	}
	if response.Outcome == "success" {
		if response.Code != "" || response.Result == nil {
			return ErrInvalidResponse
		}
		switch response.Operation {
		case ReadRTCInformation:
			if response.Result.RTCInformation == nil || response.Result.WakeAlarm != nil || response.Result.Mutation != nil || response.Result.Shutdown != nil {
				return ErrInvalidResponse
			}
			if !IsCanonicalTimestamp(response.Result.RTCInformation.RTCTime) {
				return ErrInvalidResponse
			}
			return validateWakeAlarmResult(response.Result.RTCInformation.WakeAlarm)
		case ReadWakeAlarm:
			if response.Result.WakeAlarm == nil || response.Result.RTCInformation != nil || response.Result.Mutation != nil || response.Result.Shutdown != nil {
				return ErrInvalidResponse
			}
			return validateWakeAlarmResult(*response.Result.WakeAlarm)
		case ScheduleWakeAlarm, CancelWakeAlarm:
			if response.Result.Mutation == nil || response.Result.RTCInformation != nil || response.Result.WakeAlarm != nil || response.Result.Shutdown != nil {
				return ErrInvalidResponse
			}
			return validateMutationResult(response.Operation, *response.Result.Mutation)
		case RequestShutdown:
			if response.Result.Shutdown == nil || response.Result.RTCInformation != nil || response.Result.WakeAlarm != nil || response.Result.Mutation != nil || !response.Result.Shutdown.Accepted {
				return ErrInvalidResponse
			}
			return nil
		default:
			return ErrInvalidResponse
		}
	}
	if response.Outcome != "rejected" && response.Outcome != "failed" {
		return ErrInvalidResponse
	}
	if response.Code == "" || response.Result != nil || !isFailureCode(response.Code) {
		return ErrInvalidResponse
	}
	return nil
}

func validateWakeAlarmResult(result WakeAlarmResult) error {
	switch result.State {
	case WakeAlarmUnsupported, WakeAlarmNotScheduled:
		if result.ScheduledFor != "" {
			return ErrInvalidResponse
		}
	case WakeAlarmScheduled:
		if !IsCanonicalTimestamp(result.ScheduledFor) {
			return ErrInvalidResponse
		}
	default:
		return ErrInvalidResponse
	}
	return nil
}

func validateMutationResult(operation Operation, result WakeAlarmMutationResult) error {
	if result.Before.State == WakeAlarmUnsupported || result.After.State == WakeAlarmUnsupported {
		return ErrInvalidResponse
	}
	if err := validateWakeAlarmResult(result.Before); err != nil {
		return err
	}
	if err := validateWakeAlarmResult(result.After); err != nil {
		return err
	}
	switch operation {
	case ScheduleWakeAlarm:
		switch result.Outcome {
		case "scheduled":
			if result.Before.State != WakeAlarmNotScheduled || result.After.State != WakeAlarmScheduled {
				return ErrInvalidResponse
			}
		case "replaced":
			if result.Before.State != WakeAlarmScheduled || result.After.State != WakeAlarmScheduled || result.Before.ScheduledFor == result.After.ScheduledFor {
				return ErrInvalidResponse
			}
		case "unchanged":
			if result.Before.State != WakeAlarmScheduled || result.After.State != WakeAlarmScheduled || result.Before.ScheduledFor != result.After.ScheduledFor {
				return ErrInvalidResponse
			}
		default:
			return ErrInvalidResponse
		}
	case CancelWakeAlarm:
		switch result.Outcome {
		case "cancelled":
			if result.Before.State != WakeAlarmScheduled || result.After.State != WakeAlarmNotScheduled {
				return ErrInvalidResponse
			}
		case "not_scheduled":
			if result.Before.State != WakeAlarmNotScheduled || result.After.State != WakeAlarmNotScheduled {
				return ErrInvalidResponse
			}
		default:
			return ErrInvalidResponse
		}
	default:
		return ErrInvalidResponse
	}
	return nil
}

func isKnownOperation(operation Operation) bool {
	_, ok := operations[operation]
	return ok
}

func isFailureCode(code string) bool {
	switch code {
	case "operation_unsupported", "operation_rejected", "operation_failed", "state_unavailable":
		return true
	default:
		return false
	}
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
