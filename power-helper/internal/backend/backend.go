package backend

import (
	"errors"

	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
)

// Operations expose only the fixed version-one helper operations.
type Operations interface {
	ReadRTCInformation(protocol.Request) protocol.Response
	ReadWakeAlarm(protocol.Request) protocol.Response
	ScheduleWakeAlarm(protocol.Request) protocol.Response
	CancelWakeAlarm(protocol.Request) protocol.Response
	RequestShutdown(protocol.Request) protocol.Response
}

type DenyAll struct{}

func (DenyAll) ReadRTCInformation(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) ReadWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) ScheduleWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) CancelWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (DenyAll) RequestShutdown(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

type ReadOnly struct {
	reader RTCReader
}

type RTCReader interface {
	ReadRTCInformation() (rtc.Information, error)
	ReadWakeAlarm() (rtc.WakeAlarm, error)
}

func NewReadOnly(reader RTCReader) ReadOnly {
	return ReadOnly{reader: reader}
}

func (operations ReadOnly) ReadRTCInformation(request protocol.Request) protocol.Response {
	information, err := operations.reader.ReadRTCInformation()
	if err != nil {
		return readFailure(request, err)
	}
	wakeAlarm, err := protocol.NewWakeAlarmResult(information.WakeAlarm.State, information.WakeAlarm.ScheduledFor)
	if err != nil {
		return stateUnavailable(request)
	}
	response, err := protocol.NewReadRTCInformationSuccess(information.RTCTime, wakeAlarm)
	if err != nil {
		return stateUnavailable(request)
	}
	return response
}

func (operations ReadOnly) ReadWakeAlarm(request protocol.Request) protocol.Response {
	wakeAlarm, err := operations.reader.ReadWakeAlarm()
	if err != nil {
		return readFailure(request, err)
	}
	result, err := protocol.NewWakeAlarmResult(wakeAlarm.State, wakeAlarm.ScheduledFor)
	if err != nil {
		return stateUnavailable(request)
	}
	response, err := protocol.NewReadWakeAlarmSuccess(result)
	if err != nil {
		return stateUnavailable(request)
	}
	return response
}

func (ReadOnly) ScheduleWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (ReadOnly) CancelWakeAlarm(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func (ReadOnly) RequestShutdown(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}

func readFailure(request protocol.Request, err error) protocol.Response {
	if errors.Is(err, rtc.ErrUnsupported) {
		return protocol.RejectingResponse(request)
	}
	return stateUnavailable(request)
}

func stateUnavailable(request protocol.Request) protocol.Response {
	response, err := protocol.NewFailureResponse(request.Operation, "failed", "state_unavailable")
	if err != nil {
		return protocol.Response{}
	}
	return response
}

func Dispatch(operations Operations, request protocol.Request) protocol.Response {
	switch request.Operation {
	case protocol.ReadRTCInformation:
		return operations.ReadRTCInformation(request)
	case protocol.ReadWakeAlarm:
		return operations.ReadWakeAlarm(request)
	case protocol.ScheduleWakeAlarm:
		return operations.ScheduleWakeAlarm(request)
	case protocol.CancelWakeAlarm:
		return operations.CancelWakeAlarm(request)
	case protocol.RequestShutdown:
		return operations.RequestShutdown(request)
	default:
		return protocol.RejectingResponse(request)
	}
}
