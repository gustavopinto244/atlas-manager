package backend

import (
	"context"
	"testing"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/lock"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/shutdown"
)

type fakeRTCReader struct {
	information rtc.Information
	wakeAlarm   rtc.WakeAlarm
	readErr     error
	readCalls   int
	wakeCalls   int
}

type fakeMutator struct {
	schedule rtc.Mutation
	cancel   rtc.Mutation
	err      error
	calls    int
}

type fakeShutdownRequester struct {
	calls int
	err   error
}

func (requester *fakeShutdownRequester) RequestPowerOff(context.Context) error {
	requester.calls++
	return requester.err
}

func (mutator *fakeMutator) Schedule(string) (rtc.Mutation, error) {
	mutator.calls++
	return mutator.schedule, mutator.err
}

func (mutator *fakeMutator) Cancel() (rtc.Mutation, error) {
	mutator.calls++
	return mutator.cancel, mutator.err
}

type fakeLock struct {
	sharedCalls    int
	exclusiveCalls int
	releases       int
	err            error
}

func (operationLock *fakeLock) AcquireShared() (lock.Release, error) {
	operationLock.sharedCalls++
	return operationLock.release(), operationLock.err
}

func (operationLock *fakeLock) AcquireExclusive() (lock.Release, error) {
	operationLock.exclusiveCalls++
	return operationLock.release(), operationLock.err
}

func (operationLock *fakeLock) release() lock.Release {
	return func() { operationLock.releases++ }
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

func TestLinuxOperationsSchedulesWithExclusiveLockAndTypedResponse(t *testing.T) {
	operationLock := &fakeLock{}
	mutator := &fakeMutator{schedule: rtc.Mutation{
		Before:  rtc.WakeAlarm{State: protocol.WakeAlarmNotScheduled},
		After:   rtc.WakeAlarm{State: protocol.WakeAlarmScheduled, ScheduledFor: "2026-08-02T09:00:00.000Z"},
		Outcome: "scheduled",
	}}
	request := protocol.Request{Version: protocol.Version, Operation: protocol.ScheduleWakeAlarm, RequestedAt: "2026-08-01T18:00:00.000Z", ScheduledFor: "2026-08-02T09:00:00.000Z"}
	response := Dispatch(NewLinuxOperations(&fakeRTCReader{}, mutator, &fakeShutdownRequester{}, operationLock), request)
	encoded, err := protocol.MarshalResponse(response)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"version\":1,\"operation\":\"schedule_wake_alarm\",\"outcome\":\"success\",\"result\":{\"before\":{\"state\":\"not_scheduled\"},\"after\":{\"state\":\"scheduled\",\"scheduledFor\":\"2026-08-02T09:00:00.000Z\"},\"outcome\":\"scheduled\"}}\n"
	if string(encoded) != want || operationLock.exclusiveCalls != 1 || operationLock.releases != 1 || mutator.calls != 1 {
		t.Fatalf("unexpected operation: %s lock=%#v mutator=%#v", encoded, operationLock, mutator)
	}
}

func TestLinuxOperationsReadsWithSharedLock(t *testing.T) {
	operationLock := &fakeLock{}
	reader := &fakeRTCReader{information: rtc.Information{
		RTCTime:   "2026-08-01T18:00:00.000Z",
		WakeAlarm: rtc.WakeAlarm{State: protocol.WakeAlarmNotScheduled},
	}}
	request := protocol.Request{Version: protocol.Version, Operation: protocol.ReadRTCInformation, RequestedAt: "2026-08-01T18:00:00.000Z"}
	response := Dispatch(NewLinuxOperations(reader, &fakeMutator{}, &fakeShutdownRequester{}, operationLock), request)
	if response.Outcome != "success" || operationLock.sharedCalls != 1 || operationLock.exclusiveCalls != 0 || operationLock.releases != 1 {
		t.Fatalf("unexpected shared read: %#v", operationLock)
	}
}

func TestLinuxOperationsRejectsWithoutLockOrTargetInvocation(t *testing.T) {
	operationLock := &fakeLock{err: lock.ErrUnavailable}
	mutator := &fakeMutator{}
	request := protocol.Request{Version: protocol.Version, Operation: protocol.CancelWakeAlarm, RequestedAt: "2026-08-01T18:00:00.000Z"}
	response := Dispatch(NewLinuxOperations(&fakeRTCReader{}, mutator, &fakeShutdownRequester{}, operationLock), request)
	encoded, err := protocol.MarshalResponse(response)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"version\":1,\"operation\":\"cancel_wake_alarm\",\"outcome\":\"rejected\",\"code\":\"operation_rejected\"}\n"
	if string(encoded) != want || mutator.calls != 0 || operationLock.releases != 0 {
		t.Fatalf("unexpected lock rejection: %s lock=%#v mutator=%#v", encoded, operationLock, mutator)
	}
}

func TestShutdownUsesExclusiveLockAndDoesNotReadRTC(t *testing.T) {
	operationLock := &fakeLock{}
	mutator := &fakeMutator{}
	requester := &fakeShutdownRequester{}
	request := protocol.Request{Version: protocol.Version, Operation: protocol.RequestShutdown, RequestedAt: "2026-08-01T18:00:00.000Z"}
	response := Dispatch(NewLinuxOperations(&fakeRTCReader{}, mutator, requester, operationLock), request)
	encoded, err := protocol.MarshalResponse(response)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"version\":1,\"operation\":\"request_shutdown\",\"outcome\":\"success\",\"result\":{\"accepted\":true}}\n"
	if string(encoded) != want || operationLock.sharedCalls != 0 || operationLock.exclusiveCalls != 1 || operationLock.releases != 1 || requester.calls != 1 || mutator.calls != 0 {
		t.Fatalf("shutdown acquired dependencies: %#v", operationLock)
	}
}

func TestShutdownMapsCategorizedFailures(t *testing.T) {
	for _, testCase := range []struct {
		name    string
		err     error
		outcome string
		code    string
	}{
		{name: "unsupported", err: shutdown.ErrShutdownUnsupported, outcome: "rejected", code: "operation_unsupported"},
		{name: "rejected", err: shutdown.ErrShutdownRejected, outcome: "rejected", code: "operation_rejected"},
		{name: "failed", err: shutdown.ErrShutdownFailed, outcome: "failed", code: "operation_failed"},
		{name: "uncertain", err: shutdown.ErrShutdownAcceptanceUncertain, outcome: "failed", code: "operation_failed"},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			requester := &fakeShutdownRequester{err: testCase.err}
			request := protocol.Request{Version: protocol.Version, Operation: protocol.RequestShutdown, RequestedAt: "2026-08-01T18:00:00.000Z"}
			response := Dispatch(NewLinuxOperations(&fakeRTCReader{}, &fakeMutator{}, requester, &fakeLock{}), request)
			if response.Outcome != testCase.outcome || response.Code != testCase.code || requester.calls != 1 {
				t.Fatalf("unexpected mapping: %#v", response)
			}
		})
	}
}
