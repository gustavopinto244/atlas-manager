package protocol

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestValidCorpusAndDenyAllResponses(t *testing.T) {
	files, err := filepath.Glob("../../testdata/protocol/valid/*.json")
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(files)
	if len(files) != 5 {
		t.Fatalf("expected five valid fixtures, got %d", len(files))
	}
	for _, fixture := range files {
		input := mustRead(t, fixture)
		request, err := ParseRequestLine(input)
		if err != nil {
			t.Fatalf("%s: %v", fixture, err)
		}
		encoded, err := MarshalResponse(RejectingResponse(request))
		if err != nil {
			t.Fatal(err)
		}
		want := mustRead(t, filepath.Join("../../testdata/protocol/responses", filepath.Base(fixture)))
		if string(encoded) != string(want) {
			t.Fatalf("%s: response is not canonical", fixture)
		}
	}
}

func TestInvalidCorpusRejects(t *testing.T) {
	files, err := filepath.Glob("../../testdata/protocol/invalid/*.json")
	if err != nil {
		t.Fatal(err)
	}
	for _, fixture := range files {
		if input := mustRead(t, fixture); len(input) > 0 {
			if _, err := ParseRequestLine(input); err == nil {
				t.Fatalf("%s: invalid fixture was accepted", fixture)
			}
		}
	}
}

func TestStrictBoundariesAndTimestampRules(t *testing.T) {
	valid := []byte("{\"version\":1,\"operation\":\"read_wake_alarm\",\"requestedAt\":\"2026-08-01T12:00:00.000Z\"}\n")
	for name, input := range map[string][]byte{
		"missing newline": valid[:len(valid)-1],
		"CRLF":            append(valid[:len(valid)-1], '\r', '\n'),
		"multiple lines":  append(append([]byte{}, valid...), valid...),
		"trailing data":   append(append([]byte{}, valid[:len(valid)-1]...), []byte("extra\n")...),
	} {
		if _, err := ParseRequestLine(input); err == nil {
			t.Fatalf("%s input was accepted", name)
		}
	}
	if _, err := ParseRequestLine(append(valid, make([]byte, MaxRequestBytes-len(valid)+1)...)); err == nil {
		t.Fatal("oversized request was accepted")
	}
	if _, err := ParseRequestLine([]byte("{\"version\":1,\"operation\":\"read_wake_alarm\",\"requestedAt\":\"2026-08-01T12:00:00.000Z\",\"requestedAt\":\"2026-08-01T12:01:00.000Z\"}\n")); err == nil {
		t.Fatal("duplicate field was accepted")
	}
	if !IsCanonicalTimestamp("2026-08-01T12:00:00.000Z") {
		t.Fatal("canonical timestamp was rejected")
	}
	for _, timestamp := range []string{
		"2026-08-01T12:00:00Z",
		"2026-08-01T12:00:00.000z",
		"2026-08-01T12:00:00.0000Z",
		" 2026-08-01T12:00:00.000Z",
	} {
		if IsCanonicalTimestamp(timestamp) {
			t.Fatalf("noncanonical timestamp accepted: %q", timestamp)
		}
	}
	encodedInvalidUTF8 := mustRead(t, "../../testdata/protocol/invalid/invalid-utf8.hex")
	invalidUTF8, err := hex.DecodeString(strings.TrimSpace(string(encodedInvalidUTF8)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseRequestLine(invalidUTF8); err == nil {
		t.Fatal("invalid UTF-8 was accepted")
	}
	if _, err := MarshalResponse(Response{
		Version: Version, Operation: Operation(string(ReadWakeAlarm) + string(make([]byte, MaxResponseBytes))), Outcome: "rejected", Code: "operation_unsupported",
	}); err == nil {
		t.Fatal("oversized response was accepted")
	}
}

func TestReadSuccessResponsesUseStrictCanonicalShapes(t *testing.T) {
	wakeAlarm, err := NewWakeAlarmResult(WakeAlarmScheduled, "2026-08-02T09:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	readRTC, err := NewReadRTCInformationSuccess("2026-08-01T18:00:00.000Z", wakeAlarm)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := MarshalResponse(readRTC)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"version\":1,\"operation\":\"read_rtc_information\",\"outcome\":\"success\",\"result\":{\"rtcTime\":\"2026-08-01T18:00:00.000Z\",\"wakeAlarm\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"}}}\n"
	if string(encoded) != want {
		t.Fatalf("unexpected canonical RTC response: %s", encoded)
	}

	readWake, err := NewReadWakeAlarmSuccess(wakeAlarm)
	if err != nil {
		t.Fatal(err)
	}
	encoded, err = MarshalResponse(readWake)
	if err != nil {
		t.Fatal(err)
	}
	want = "{\"version\":1,\"operation\":\"read_wake_alarm\",\"outcome\":\"success\",\"result\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"}}\n"
	if string(encoded) != want {
		t.Fatalf("unexpected canonical wake response: %s", encoded)
	}
}

func TestSuccessResponseFixturesAreCanonicalGoOutput(t *testing.T) {
	wakeStates := []struct {
		name         string
		state        string
		scheduledFor string
	}{
		{name: "unsupported", state: WakeAlarmUnsupported},
		{name: "not_scheduled", state: WakeAlarmNotScheduled},
		{name: "scheduled", state: WakeAlarmScheduled, scheduledFor: "2026-08-02T09:00:00.000Z"},
	}
	for _, testCase := range wakeStates {
		t.Run("read_rtc_information_"+testCase.name, func(t *testing.T) {
			wakeAlarm, err := NewWakeAlarmResult(testCase.state, testCase.scheduledFor)
			if err != nil {
				t.Fatal(err)
			}
			response, err := NewReadRTCInformationSuccess("2026-08-01T18:00:00.000Z", wakeAlarm)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := MarshalResponse(response)
			if err != nil {
				t.Fatal(err)
			}
			want := mustRead(t, "../../testdata/protocol/responses/success/read_rtc_information_"+testCase.name+".json")
			if string(encoded) != string(want) {
				t.Fatalf("fixture mismatch: %s", encoded)
			}
		})
		t.Run("read_wake_alarm_"+testCase.name, func(t *testing.T) {
			wakeAlarm, err := NewWakeAlarmResult(testCase.state, testCase.scheduledFor)
			if err != nil {
				t.Fatal(err)
			}
			response, err := NewReadWakeAlarmSuccess(wakeAlarm)
			if err != nil {
				t.Fatal(err)
			}
			encoded, err := MarshalResponse(response)
			if err != nil {
				t.Fatal(err)
			}
			want := mustRead(t, "../../testdata/protocol/responses/success/read_wake_alarm_"+testCase.name+".json")
			if string(encoded) != string(want) {
				t.Fatalf("fixture mismatch: %s", encoded)
			}
		})
	}
}

func TestReadSuccessConstructorsRejectInvalidStatesAndOperations(t *testing.T) {
	for _, state := range []WakeAlarmResult{
		{State: "unknown"},
		{State: WakeAlarmScheduled},
		{State: WakeAlarmNotScheduled, ScheduledFor: "2026-08-02T09:00:00.000Z"},
	} {
		if _, err := NewWakeAlarmResult(state.State, state.ScheduledFor); err == nil {
			t.Fatalf("invalid wake state accepted: %#v", state)
		}
	}
	if _, err := NewReadRTCInformationSuccess("2026-08-01T18:00:00Z", WakeAlarmResult{State: WakeAlarmNotScheduled}); err == nil {
		t.Fatal("noncanonical RTC time accepted")
	}
	if _, err := NewFailureResponse(ReadWakeAlarm, "success", "operation_unsupported"); err == nil {
		t.Fatal("success failure response accepted")
	}
}

func TestMutationSuccessConstructorsSerializeCanonicalResults(t *testing.T) {
	notScheduled, err := NewWakeAlarmResult(WakeAlarmNotScheduled, "")
	if err != nil {
		t.Fatal(err)
	}
	t1, err := NewWakeAlarmResult(WakeAlarmScheduled, "2026-08-02T09:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	t2, err := NewWakeAlarmResult(WakeAlarmScheduled, "2026-08-02T10:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name     string
		response Response
		want     string
	}{
		{"scheduled", mustScheduleResponse(t, notScheduled, t1, "scheduled"), "{\"version\":1,\"operation\":\"schedule_wake_alarm\",\"outcome\":\"success\",\"result\":{\"before\":{\"state\":\"not_scheduled\"},\"after\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"},\"outcome\":\"scheduled\"}}\n"},
		{"replaced", mustScheduleResponse(t, t1, t2, "replaced"), "{\"version\":1,\"operation\":\"schedule_wake_alarm\",\"outcome\":\"success\",\"result\":{\"before\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"},\"after\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T10:00:00.000Z\"},\"outcome\":\"replaced\"}}\n"},
		{"unchanged", mustScheduleResponse(t, t1, t1, "unchanged"), "{\"version\":1,\"operation\":\"schedule_wake_alarm\",\"outcome\":\"success\",\"result\":{\"before\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"},\"after\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"},\"outcome\":\"unchanged\"}}\n"},
		{"cancelled", mustCancelResponse(t, t1, notScheduled, "cancelled"), "{\"version\":1,\"operation\":\"cancel_wake_alarm\",\"outcome\":\"success\",\"result\":{\"before\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"},\"after\":{\"state\":\"not_scheduled\"},\"outcome\":\"cancelled\"}}\n"},
		{"absent", mustCancelResponse(t, notScheduled, notScheduled, "not_scheduled"), "{\"version\":1,\"operation\":\"cancel_wake_alarm\",\"outcome\":\"success\",\"result\":{\"before\":{\"state\":\"not_scheduled\"},\"after\":{\"state\":\"not_scheduled\"},\"outcome\":\"not_scheduled\"}}\n"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			encoded, err := MarshalResponse(testCase.response)
			if err != nil || string(encoded) != testCase.want {
				t.Fatalf("got %s, error %v", encoded, err)
			}
		})
	}
}

func TestMutationConstructorsRejectImpossibleTransitions(t *testing.T) {
	notScheduled, _ := NewWakeAlarmResult(WakeAlarmNotScheduled, "")
	scheduled, _ := NewWakeAlarmResult(WakeAlarmScheduled, "2026-08-02T09:00:00.000Z")
	cases := []struct {
		name string
		make func() (Response, error)
	}{
		{"schedule cancelled", func() (Response, error) { return NewScheduleWakeAlarmSuccess(notScheduled, scheduled, "cancelled") }},
		{"schedule replaced same", func() (Response, error) { return NewScheduleWakeAlarmSuccess(scheduled, scheduled, "replaced") }},
		{"cancel scheduled after", func() (Response, error) { return NewCancelWakeAlarmSuccess(scheduled, scheduled, "cancelled") }},
		{"cancel scheduled outcome", func() (Response, error) { return NewCancelWakeAlarmSuccess(notScheduled, notScheduled, "scheduled") }},
		{"schedule unsupported", func() (Response, error) {
			return NewScheduleWakeAlarmSuccess(WakeAlarmResult{State: WakeAlarmUnsupported}, scheduled, "scheduled")
		}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := testCase.make(); err == nil {
				t.Fatal("impossible transition accepted")
			}
		})
	}
}

func TestMutationSuccessFixturesMatchGoSerialization(t *testing.T) {
	notScheduled, _ := NewWakeAlarmResult(WakeAlarmNotScheduled, "")
	t1, _ := NewWakeAlarmResult(WakeAlarmScheduled, "2026-08-02T09:00:00.000Z")
	t2, _ := NewWakeAlarmResult(WakeAlarmScheduled, "2026-08-02T10:00:00.000Z")
	cases := []struct {
		fixture  string
		response Response
	}{
		{"schedule_wake_alarm_scheduled.json", mustScheduleResponse(t, notScheduled, t1, "scheduled")},
		{"schedule_wake_alarm_replaced.json", mustScheduleResponse(t, t1, t2, "replaced")},
		{"schedule_wake_alarm_unchanged.json", mustScheduleResponse(t, t1, t1, "unchanged")},
		{"cancel_wake_alarm_cancelled.json", mustCancelResponse(t, t1, notScheduled, "cancelled")},
		{"cancel_wake_alarm_not_scheduled.json", mustCancelResponse(t, notScheduled, notScheduled, "not_scheduled")},
	}
	for _, testCase := range cases {
		t.Run(testCase.fixture, func(t *testing.T) {
			encoded, err := MarshalResponse(testCase.response)
			if err != nil {
				t.Fatal(err)
			}
			want := mustRead(t, "../../testdata/protocol/responses/success/"+testCase.fixture)
			if string(encoded) != string(want) {
				t.Fatalf("fixture mismatch: %s", encoded)
			}
		})
	}
}

func mustScheduleResponse(t *testing.T, before WakeAlarmResult, after WakeAlarmResult, outcome string) Response {
	t.Helper()
	response, err := NewScheduleWakeAlarmSuccess(before, after, outcome)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func mustCancelResponse(t *testing.T, before WakeAlarmResult, after WakeAlarmResult, outcome string) Response {
	t.Helper()
	response, err := NewCancelWakeAlarmSuccess(before, after, outcome)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func mustRead(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
}
