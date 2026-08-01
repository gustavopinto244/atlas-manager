package backend

import "github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"

// Operations deliberately contain no operating-system implementation in this issue.
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
