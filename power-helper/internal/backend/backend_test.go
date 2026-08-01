package backend

import (
	"testing"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
)

type fakeRTCReader struct {
	information rtc.Information
	wakeAlarm   rtc.WakeAlarm
	readErr     error
	readCalls   int
	wakeCalls   int
}

func (reader *fakeRTCReader) ReadRTCInformation() (rtc.Information, error) {
	reader.readCalls++
	return reader.information, reader.readErr
}

func (reader *fakeRTCReader) ReadWakeAlarm() (rtc.WakeAlarm, error) {
	reader.wakeCalls++
	return reader.wakeAlarm, reader.readErr
}

func TestDenyAllBackendRejectsEveryValidOperation(t *testing.T) {
	backend := DenyAll{}
	for _, operation := range []protocol.Operation{
		protocol.ReadRTCInformation,
		protocol.ReadWakeAlarm,
		protocol.ScheduleWakeAlarm,
		protocol.CancelWakeAlarm,
		protocol.RequestShutdown,
	} {
		request := protocol.Request{
			Version:      protocol.Version,
			Operation:    operation,
			RequestedAt:  "2026-08-01T12:00:00.000Z",
			ScheduledFor: "2026-08-02T09:00:00.000Z",
		}
		response := Dispatch(backend, request)
		if response != protocol.RejectingResponse(request) {
			t.Fatalf("unexpected response for %s: %#v", operation, response)
		}
	}
}

func TestReadOnlyBackendReturnsStrictRTCInformationSuccess(t *testing.T) {
	reader := &fakeRTCReader{information: rtc.Information{
		RTCTime:   "2026-08-01T18:00:00.000Z",
		WakeAlarm: rtc.WakeAlarm{State: protocol.WakeAlarmScheduled, ScheduledFor: "2026-08-02T09:00:00.000Z"},
	}}
	request := protocol.Request{Version: protocol.Version, Operation: protocol.ReadRTCInformation, RequestedAt: "2026-08-01T18:00:00.000Z"}
	response := Dispatch(NewReadOnly(reader), request)
	encoded, err := protocol.MarshalResponse(response)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"version\":1,\"operation\":\"read_rtc_information\",\"outcome\":\"success\",\"result\":{\"rtcTime\":\"2026-08-01T18:00:00.000Z\",\"wakeAlarm\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"}}}\n"
	if string(encoded) != want {
		t.Fatalf("unexpected response: %s", encoded)
	}
	if reader.readCalls != 1 || reader.wakeCalls != 0 {
		t.Fatalf("unexpected reader calls: %#v", reader)
	}
}

func TestReadOnlyBackendDoesNotReadRTCForMutationOperations(t *testing.T) {
	reader := &fakeRTCReader{}
	operations := NewReadOnly(reader)
	for _, operation := range []protocol.Operation{protocol.ScheduleWakeAlarm, protocol.CancelWakeAlarm, protocol.RequestShutdown} {
		request := protocol.Request{Version: protocol.Version, Operation: operation, RequestedAt: "2026-08-01T18:00:00.000Z", ScheduledFor: "2026-08-02T09:00:00.000Z"}
		response := Dispatch(operations, request)
		if response != protocol.RejectingResponse(request) {
			t.Fatalf("unexpected response for %s: %#v", operation, response)
		}
	}
	if reader.readCalls != 0 || reader.wakeCalls != 0 {
		t.Fatalf("mutation operation read RTC: %#v", reader)
	}
}
