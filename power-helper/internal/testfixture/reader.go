package testfixture

import (
	"github.com/atlas-manager/atlas-manager/power-helper/internal/protocol"
	"github.com/atlas-manager/atlas-manager/power-helper/internal/rtc"
)

// Reader is a deterministic compatibility fixture. It is imported only by the
// separately named fixture executable and never by the production command.
type Reader struct{}

func (Reader) ReadRTCInformation() (rtc.Information, error) {
	return rtc.Information{
		RTCTime: "2026-08-01T18:00:00.000Z",
		WakeAlarm: rtc.WakeAlarm{
			State:        "scheduled",
			ScheduledFor: "2026-08-02T09:00:00.000Z",
		},
	}, nil
}

func (Reader) ReadWakeAlarm() (rtc.WakeAlarm, error) {
	return rtc.WakeAlarm{State: "scheduled", ScheduledFor: "2026-08-02T09:00:00.000Z"}, nil
}

type Operations struct {
	wakeAlarm rtc.WakeAlarm
}

func NewOperations() *Operations {
	return &Operations{wakeAlarm: rtc.WakeAlarm{State: protocol.WakeAlarmNotScheduled}}
}

func (operations *Operations) ReadRTCInformation(request protocol.Request) protocol.Response {
	wakeAlarm, err := protocol.NewWakeAlarmResult(operations.wakeAlarm.State, operations.wakeAlarm.ScheduledFor)
	if err != nil {
		return protocol.RejectingResponse(request)
	}
	response, err := protocol.NewReadRTCInformationSuccess("2026-08-01T18:00:00.000Z", wakeAlarm)
	if err != nil {
		return protocol.RejectingResponse(request)
	}
	return response
}

func (operations *Operations) ReadWakeAlarm(request protocol.Request) protocol.Response {
	wakeAlarm, err := protocol.NewWakeAlarmResult(operations.wakeAlarm.State, operations.wakeAlarm.ScheduledFor)
	if err != nil {
		return protocol.RejectingResponse(request)
	}
	response, err := protocol.NewReadWakeAlarmSuccess(wakeAlarm)
	if err != nil {
		return protocol.RejectingResponse(request)
	}
	return response
}

func (operations *Operations) ScheduleWakeAlarm(request protocol.Request) protocol.Response {
	before, _ := protocol.NewWakeAlarmResult(operations.wakeAlarm.State, operations.wakeAlarm.ScheduledFor)
	after := before
	outcome := "unchanged"
	if before.State == protocol.WakeAlarmNotScheduled {
		after, _ = protocol.NewWakeAlarmResult(protocol.WakeAlarmScheduled, request.ScheduledFor)
		outcome = "scheduled"
	} else if before.ScheduledFor != request.ScheduledFor {
		after, _ = protocol.NewWakeAlarmResult(protocol.WakeAlarmScheduled, request.ScheduledFor)
		outcome = "replaced"
	}
	response, err := protocol.NewScheduleWakeAlarmSuccess(before, after, outcome)
	if err != nil {
		return protocol.RejectingResponse(request)
	}
	operations.wakeAlarm = rtc.WakeAlarm{State: after.State, ScheduledFor: after.ScheduledFor}
	return response
}

func (operations *Operations) CancelWakeAlarm(request protocol.Request) protocol.Response {
	before, _ := protocol.NewWakeAlarmResult(operations.wakeAlarm.State, operations.wakeAlarm.ScheduledFor)
	after := before
	outcome := "not_scheduled"
	if before.State == protocol.WakeAlarmScheduled {
		after, _ = protocol.NewWakeAlarmResult(protocol.WakeAlarmNotScheduled, "")
		outcome = "cancelled"
	}
	response, err := protocol.NewCancelWakeAlarmSuccess(before, after, outcome)
	if err != nil {
		return protocol.RejectingResponse(request)
	}
	operations.wakeAlarm = rtc.WakeAlarm{State: after.State, ScheduledFor: after.ScheduledFor}
	return response
}

func (*Operations) RequestShutdown(request protocol.Request) protocol.Response {
	return protocol.RejectingResponse(request)
}
